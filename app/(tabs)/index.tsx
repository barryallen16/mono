import { Audio } from 'expo-av';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteCard, NotePatch } from '~/components/note-card';
import { MonoLogo, PixelIcon } from '~/components/pixel-icon';
import {
  Button,
  ErrorBanner,
  Field,
  Panel,
  ScreenHeader,
  Sheet,
  Tappable,
  tabularNums,
} from '~/components/ui';
import { discardTempAudioClip, stopActivePlayback } from '~/utils/audio';
import { getCactusStatus, prepareCactusModels, subscribeCactusProgress } from '~/utils/cactus';
import {
  computeStreak,
  createQuickNote,
  deleteNote,
  listNotes,
  MonoNote,
  processSavedNote,
  toggleActionItem,
  updateNote,
} from '~/utils/db';
import { formatDuration } from '~/utils/notes';
import { hasSeenOnboarding } from '~/utils/onboarding';

const MAX_RECORDING_SECONDS = 120;

interface ModelProgressState {
  label: string;
  pill: string;
  pct: number | null;
}

function getRecordingOptions(): Audio.RecordingOptions {
  const base = Audio.RecordingOptionsPresets.HIGH_QUALITY;
  const android: Audio.RecordingOptionsAndroid = {
    ...base.android,
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  };

  if (Platform.OS !== 'web' || typeof MediaRecorder === 'undefined') {
    return {
      ...base,
      isMeteringEnabled: true,
      android,
    };
  }

  const webOptions: Audio.RecordingOptionsWeb = { ...base.web };
  if (typeof MediaRecorder.isTypeSupported === 'function') {
    if (MediaRecorder.isTypeSupported('audio/webm')) {
      webOptions.mimeType = 'audio/webm';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      webOptions.mimeType = 'audio/mp4';
    }
  }

  return {
    ...base,
    isMeteringEnabled: true,
    android,
    web: webOptions,
  };
}

export default function CaptureScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isRecorderBusy, setIsRecorderBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0.08);
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestNote, setLatestNote] = useState<MonoNote | null>(null);
  const [streak, setStreak] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<MonoNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [modelProgress, setModelProgress] = useState<ModelProgressState | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const maxDurationMsRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const autoPrepareRef = useRef(false);
  const latestNoteRef = useRef<MonoNote | null>(null);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  latestNoteRef.current = latestNote;

  const refreshLatest = useCallback(async () => {
    try {
      const notes = await listNotes();
      if (!mountedRef.current) return;
      setLatestNote(notes[0] ?? null);
      setStreak(computeStreak(notes));
    } catch {
      if (mountedRef.current) setError('Could not read local database.');
    }
  }, []);

  const runBackgroundProcessing = useCallback(
    (noteId: number, initialDraft = '') => {
      processSavedNote(noteId, initialDraft)
        .then((processed) => {
          if (!mountedRef.current || !processed) return;
          setLatestNote((prev) => (prev && prev.id === processed.id ? processed : prev));
          refreshLatest();
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          const msg = err instanceof Error ? err.message : 'Background note processing failed.';
          setError(msg);
          refreshLatest();
        });
    },
    [refreshLatest]
  );

  useFocusEffect(
    useCallback(() => {
      refreshLatest();
      Promise.all([hasSeenOnboarding().catch(() => false), getCactusStatus().catch(() => null)])
        .then(([seen, status]) => {
          if (!mountedRef.current || !seen) return;
          if (
            status?.supported &&
            !autoPrepareRef.current &&
            (!status.whistleLoaded || !status.needleLoaded)
          ) {
            autoPrepareRef.current = true;
            prepareCactusModels()
              .catch(() => {})
              .finally(() => {
                if (mountedRef.current) setModelProgress(null);
              });
          }
        })
        .catch(() => {});
      return () => {
        stopActivePlayback();
        if (recordingRef.current && !busyRef.current) {
          stopRecordingRef.current();
        }
      };
    }, [refreshLatest])
  );

  useEffect(() => {
    const sub = subscribeCactusProgress((ev) => {
      if (!mountedRef.current) return;
      const targetName = ev.model === 'whistle' ? 'speech model' : 'note extractor';
      if (ev.phase === 'downloading') {
        if (ev.progress >= 0) {
          const pct = Math.min(100, Math.max(0, Math.round(ev.progress * 100)));
          setModelProgress({
            label: `Downloading ${targetName}`,
            pill: `${pct}%`,
            pct,
          });
        } else {
          const mb = (ev.receivedBytes / (1024 * 1024)).toFixed(1);
          setModelProgress({
            label: `Downloading ${targetName}`,
            pill: `${mb} MB`,
            pct: null,
          });
        }
      } else if (ev.phase === 'loading') {
        setModelProgress({
          label: `Loading ${targetName}...`,
          pill: 'Loading...',
          pct: null,
        });
      } else {
        setModelProgress(null);
      }
    });
    return () => {
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const active = recordingRef.current;
      recordingRef.current = null;
      if (active) {
        active.setOnRecordingStatusUpdate(null);
        active
          .stopAndUnloadAsync()
          .then(() => discardTempAudioClip(active.getURI()))
          .catch(() => {});
      }
      stopActivePlayback();
    };
  }, []);

  const stopRecording = useCallback(async () => {
    if (busyRef.current || !recordingRef.current) return;
    busyRef.current = true;
    setIsRecorderBusy(true);

    const active = recordingRef.current;
    recordingRef.current = null;
    active.setOnRecordingStatusUpdate(null);

    try {
      const status = await active.stopAndUnloadAsync();
      const uri = active.getURI();

      if (Platform.OS !== 'web') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        }).catch(() => {});
      }

      if (!mountedRef.current) {
        await discardTempAudioClip(uri);
        return;
      }

      setIsRecording(false);
      setMeterLevel(0.08);
      const rawDuration = status.durationMillis;
      const statusSec = Number.isFinite(rawDuration) ? Math.round((rawDuration ?? 0) / 1000) : 0;
      const trackedSec = Math.round(maxDurationMsRef.current / 1000);
      const durationSec = Math.max(1, trackedSec, statusSec);

      if (!uri) {
        setError('Recording finished without audio output.');
        return;
      }

      try {
        const saved = await createQuickNote('', durationSec, uri);
        if (saved.audioUri !== uri) {
          await discardTempAudioClip(uri);
        }
        if (!mountedRef.current) return;
        setLatestNote(saved);
        setElapsedSec(0);
        refreshLatest();
        runBackgroundProcessing(saved.id);
      } catch (err) {
        await discardTempAudioClip(uri);
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('QuotaExceeded') || msg.includes('quota')) {
          setError('Browser storage is full. Clear older notes in Vault first.');
        } else {
          setError('Failed to save note locally.');
        }
      }
    } catch {
      if (mountedRef.current) {
        setIsRecording(false);
        setMeterLevel(0.08);
        setError('Could not finalize audio clip.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsRecorderBusy(false);
    }
  }, [refreshLatest, runBackgroundProcessing]);

  stopRecordingRef.current = stopRecording;

  const startRecording = async () => {
    if (busyRef.current || recordingRef.current || isSaving) return;
    busyRef.current = true;
    setIsRecorderBusy(true);
    setError(null);

    try {
      await stopActivePlayback();
      const permission = await Audio.requestPermissionsAsync();
      if (!mountedRef.current) return;
      if (!permission.granted) {
        setError('Microphone permission is required to record voice notes.');
        return;
      }

      if (Platform.OS !== 'web') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
      }

      const { recording: created } = await Audio.Recording.createAsync(getRecordingOptions());
      if (!mountedRef.current) {
        await created.stopAndUnloadAsync().catch(() => {});
        await discardTempAudioClip(created.getURI());
        return;
      }

      recordingRef.current = created;
      maxDurationMsRef.current = 0;
      setIsRecording(true);
      setElapsedSec(0);
      setMeterLevel(0.08);

      created.setProgressUpdateInterval(250);
      created.setOnRecordingStatusUpdate((status) => {
        if (!mountedRef.current || recordingRef.current !== created) return;
        const durationMs = Number.isFinite(status.durationMillis)
          ? (status.durationMillis ?? 0)
          : 0;
        if (durationMs > maxDurationMsRef.current) {
          maxDurationMsRef.current = durationMs;
        }
        const nextSec = Math.floor(durationMs / 1000);
        setElapsedSec(nextSec);

        if (typeof status.metering === 'number' && Number.isFinite(status.metering)) {
          const normalized = Math.min(1, Math.max(0.08, (status.metering + 60) / 60));
          setMeterLevel(normalized);
        }

        if (durationMs >= MAX_RECORDING_SECONDS * 1000 && !busyRef.current) {
          stopRecording();
        }
      });
    } catch {
      if (mountedRef.current) {
        setError('Could not start audio recording.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsRecorderBusy(false);
    }
  };

  const handleSaveTextNote = async () => {
    const trimmed = draftText.trim();
    if (!trimmed || isSaving || isRecorderBusy || isRecording) return;

    Keyboard.dismiss();
    await stopActivePlayback();
    setIsSaving(true);
    setError(null);
    try {
      const saved = await createQuickNote(trimmed, 0, null);
      if (!mountedRef.current) return;
      setLatestNote(saved);
      setDraftText('');
      setShowTextComposer(false);
      refreshLatest();
      runBackgroundProcessing(saved.id, trimmed);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('QuotaExceeded') || msg.includes('quota')) {
        setError('Browser storage is full. Clear older notes in Vault first.');
      } else {
        setError('Failed to save note locally.');
      }
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const handleToggleAction = async (noteId: number, actionId: string) => {
    try {
      const updated = await toggleActionItem(noteId, actionId);
      if (updated && mountedRef.current) setLatestNote(updated);
    } catch {
      if (mountedRef.current) setError('Could not update task state.');
    }
  };

  const handleUpdateNote = async (noteId: number, patch: NotePatch) => {
    try {
      const updated = await updateNote(noteId, patch);
      if (updated && mountedRef.current) setLatestNote(updated);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Could not save note changes.');
      }
      throw err;
    }
  };

  const handleRetryNote = (noteId: number) => {
    setError(null);
    setLatestNote((prev) =>
      prev && prev.id === noteId
        ? {
            ...prev,
            audioState: prev.audioUri ? 'pending' : prev.audioState,
            lastError: null,
          }
        : prev
    );
    runBackgroundProcessing(noteId);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await stopActivePlayback();
      await deleteNote(confirmDelete.id);
      if (!mountedRef.current) return;
      setConfirmDelete(null);
      await refreshLatest();
    } catch {
      if (mountedRef.current) setError('Could not delete note.');
    } finally {
      if (mountedRef.current) setIsDeleting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="mono"
        titleNode={<MonoLogo height={20} color="#ffffff" />}
        subtitle="Offline voice notes"
        right={
          isRecording ? (
            <View className="flex-row items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5">
              <View className="h-2 w-2 rounded-sm bg-danger" />
              <Text className="font-mono text-xs text-ink" style={tabularNums} numberOfLines={1}>
                {formatDuration(elapsedSec)}
              </Text>
            </View>
          ) : modelProgress ? (
            <View className="flex-row items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5">
              <View className="h-2 w-2 rounded-sm bg-accent" />
              <Text className="font-mono text-xs text-ink" style={tabularNums} numberOfLines={1}>
                {modelProgress.pill}
              </Text>
            </View>
          ) : (
            <View className="flex-row items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5">
              <PixelIcon name="zap" size={16} color="#9d91cc" />
              <Text className="font-pixel text-sm text-ink" style={tabularNums}>
                {streak}d
              </Text>
            </View>
          )
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled">
          <View className="w-full max-w-2xl gap-4 self-center">
            {modelProgress ? (
              <Panel className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono-medium text-xs text-ink">{modelProgress.label}</Text>
                  <Text className="font-mono text-xs text-muted" style={tabularNums}>
                    {modelProgress.pill}
                  </Text>
                </View>
                <View className="h-2 overflow-hidden rounded-sm border border-line bg-bg">
                  <View
                    className="h-full bg-accent"
                    style={{
                      width: modelProgress.pct !== null ? `${modelProgress.pct}%` : '35%',
                    }}
                  />
                </View>
              </Panel>
            ) : null}

            <Panel className="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-pixel text-lg text-ink">
                  {isRecording ? 'Recording...' : 'New entry'}
                </Text>
                <Text className="font-mono text-xs text-muted" style={tabularNums}>
                  {formatDuration(isRecording ? elapsedSec : 0)} / 02:00
                </Text>
              </View>

              <Button
                label={isRecording ? 'Stop recording' : 'Record voice'}
                icon={isRecording ? 'square' : 'mic'}
                variant={isRecording ? 'danger' : 'primary'}
                disabled={isRecorderBusy || isSaving}
                onPress={isRecording ? stopRecording : startRecording}
              />

              {isRecording ? (
                <View className="gap-1.5">
                  <View className="h-2 overflow-hidden rounded-sm border border-line bg-bg">
                    <View
                      className="h-full bg-danger"
                      style={{ width: `${Math.round(meterLevel * 100)}%` }}
                    />
                  </View>
                </View>
              ) : null}

              <View className="flex-row items-center justify-between">
                <Tappable
                  onPress={() => setShowTextComposer((v) => !v)}
                  disabled={isRecording || isSaving}
                  className="flex-row items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
                  <PixelIcon name={showTextComposer ? 'close' : 'edit'} size={16} color="#d4cef0" />
                  <Text className="font-mono-medium text-xs text-ink">
                    {showTextComposer ? 'Hide text' : 'Type note'}
                  </Text>
                </Tappable>
                {!isRecording ? (
                  <Text className="font-mono text-xs text-muted">Saved locally on stop</Text>
                ) : null}
              </View>

              {showTextComposer ? (
                <View className="gap-3 border-t border-line pt-3">
                  <Field
                    placeholder="Type a note, todo, or reminder..."
                    value={draftText}
                    onChangeText={setDraftText}
                    multiline
                    maxLength={5000}
                  />
                  <View className="flex-row items-center justify-between gap-3">
                    <Text className="font-mono text-xs text-muted" style={tabularNums}>
                      {draftText.length}/5000
                    </Text>
                    <Button
                      label="Save text note"
                      icon="check"
                      variant="secondary"
                      onPress={handleSaveTextNote}
                      loading={isSaving}
                      disabled={!draftText.trim() || isRecording || isRecorderBusy}
                    />
                  </View>
                </View>
              ) : null}
            </Panel>

            {error ? <ErrorBanner>{error}</ErrorBanner> : null}

            {latestNote ? (
              <NoteCard
                key={latestNote.id}
                note={latestNote}
                onToggleAction={handleToggleAction}
                onUpdate={handleUpdateNote}
                onDelete={setConfirmDelete}
                onRetry={handleRetryNote}
                onAudioError={setError}
              />
            ) : (
              <Panel className="items-start gap-2">
                <Text className="font-pixel text-base text-ink">No entries yet</Text>
                <Text className="font-mono text-xs leading-5 text-muted">
                  Record a voice clip or type a note above. Your phone transcribes speech and pulls
                  out tasks offline.
                </Text>
              </Panel>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={confirmDelete !== null}
        onClose={() => !isDeleting && setConfirmDelete(null)}
        title="Delete entry?">
        <View className="gap-4">
          <Text className="font-mono text-xs leading-5 text-muted">
            This removes the entry and its saved audio clip from local storage.
          </Text>
          <View className="gap-2.5">
            <Button
              label="Delete"
              icon="trash"
              variant="danger"
              loading={isDeleting}
              onPress={handleConfirmDelete}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={isDeleting}
              onPress={() => setConfirmDelete(null)}
            />
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
