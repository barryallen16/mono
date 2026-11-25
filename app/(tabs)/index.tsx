import {
  RecordingOptions,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureComposer, RecordingMode } from '~/components/capture-composer';
import { NoteCard, NotePatch } from '~/components/note-card';
import { MonoLogo, PixelIcon } from '~/components/pixel-icon';
import { Button, ErrorBanner, Panel, ScreenHeader, Sheet, tabularNums } from '~/components/ui';
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

function getRecordingOptions(): RecordingOptions {
  const base = RecordingPresets.HIGH_QUALITY;
  const android: RecordingOptions['android'] = {
    ...base.android,
    extension: '.m4a',
    sampleRate: 16000,
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  };

  if (Platform.OS !== 'web' || typeof MediaRecorder === 'undefined') {
    return {
      ...base,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 64000,
      isMeteringEnabled: true,
      android,
    };
  }

  const webOptions: NonNullable<RecordingOptions['web']> = { ...base.web };
  if (typeof MediaRecorder.isTypeSupported === 'function') {
    if (MediaRecorder.isTypeSupported('audio/webm')) {
      webOptions.mimeType = 'audio/webm';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      webOptions.mimeType = 'audio/mp4';
    }
  }

  return {
    ...base,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
    isMeteringEnabled: true,
    android,
    web: webOptions,
  };
}

export default function CaptureScreen() {
  const router = useRouter();
  const recordingOptions = useMemo(() => getRecordingOptions(), []);
  const recorder = useAudioRecorder(recordingOptions);

  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle');
  const [isRecorderBusy, setIsRecorderBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0.08);
  const [holdHint, setHoldHint] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestNote, setLatestNote] = useState<MonoNote | null>(null);
  const [streak, setStreak] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<MonoNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [modelProgress, setModelProgress] = useState<ModelProgressState | null>(null);

  const recordingActiveRef = useRef(false);
  const wantRecordingRef = useRef(false);
  const recordingModeRef = useRef<RecordingMode>('idle');
  const recordingStartedAtRef = useRef(0);
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationMsRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const autoPrepareRef = useRef(false);
  const latestNoteRef = useRef<MonoNote | null>(null);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  latestNoteRef.current = latestNote;
  const isRecording = recordingMode !== 'idle';

  const flashHint = useCallback((message: string) => {
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
    }
    setHoldHint(message);
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      if (mountedRef.current) setHoldHint(null);
    }, 2400);
  }, []);

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
        wantRecordingRef.current = false;
        if (recordingActiveRef.current && !busyRef.current) {
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
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      wantRecordingRef.current = false;
      if (recordingActiveRef.current) {
        recordingActiveRef.current = false;
        recorder
          .stop()
          .then(() => discardTempAudioClip(recorder.uri))
          .catch(() => {});
      }
      stopActivePlayback();
    };
  }, [recorder]);

  const resetRecordingUi = useCallback(() => {
    recordingModeRef.current = 'idle';
    setRecordingMode('idle');
    setElapsedSec(0);
    setMeterLevel(0.08);
  }, []);

  const cancelRecording = useCallback(
    async (hintMessage?: string) => {
      wantRecordingRef.current = false;
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      resetRecordingUi();

      if (recordingActiveRef.current) {
        busyRef.current = true;
        setIsRecorderBusy(true);
        recordingActiveRef.current = false;
        try {
          const preStopStatus = recorder.getStatus();
          await recorder.stop().catch(() => {});
          const uri = recorder.uri ?? preStopStatus.url ?? recorder.getStatus().url;
          await discardTempAudioClip(uri);
          if (Platform.OS !== 'web') {
            await setAudioModeAsync({
              allowsRecording: false,
              playsInSilentMode: true,
            }).catch(() => {});
          }
        } finally {
          busyRef.current = false;
          if (mountedRef.current) setIsRecorderBusy(false);
        }
      }

      if (hintMessage && mountedRef.current) {
        flashHint(hintMessage);
      }
    },
    [flashHint, recorder, resetRecordingUi]
  );

  const stopRecording = useCallback(async () => {
    if (busyRef.current || !recordingActiveRef.current) return;
    busyRef.current = true;
    setIsRecorderBusy(true);
    wantRecordingRef.current = false;
    recordingActiveRef.current = false;

    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
    }

    const elapsedMs = Math.max(
      maxDurationMsRef.current,
      Date.now() - recordingStartedAtRef.current
    );
    resetRecordingUi();

    try {
      const preStopStatus = recorder.getStatus();
      await recorder.stop();
      const uri = recorder.uri ?? preStopStatus.url ?? recorder.getStatus().url;

      if (Platform.OS !== 'web') {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        }).catch(() => {});
      }

      if (!mountedRef.current) {
        await discardTempAudioClip(uri);
        return;
      }

      const rawDuration = preStopStatus.durationMillis;
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
    } catch (err) {
      await discardTempAudioClip(recorder.uri).catch(() => {});
      if (Platform.OS !== 'web') {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        }).catch(() => {});
      }
      if (mountedRef.current) {
        if (elapsedMs < 700) {
          flashHint('Hold mic a bit longer to record');
        } else {
          const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
          setError(`Could not finalize audio clip${detail}.`);
        }
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsRecorderBusy(false);
    }
  }, [flashHint, recorder, refreshLatest, resetRecordingUi, runBackgroundProcessing]);

  stopRecordingRef.current = stopRecording;

  const startRecording = async () => {
    if (busyRef.current || recordingActiveRef.current || isSaving) return;
    busyRef.current = true;
    setIsRecorderBusy(true);
    setError(null);
    setHoldHint(null);

    try {
      await stopActivePlayback();
      if (!mountedRef.current || !wantRecordingRef.current) {
        resetRecordingUi();
        return;
      }

      const permission = await requestRecordingPermissionsAsync();
      if (!mountedRef.current) return;
      if (!permission.granted) {
        wantRecordingRef.current = false;
        resetRecordingUi();
        setError('Microphone permission is required to record voice notes.');
        return;
      }
      if (!wantRecordingRef.current) {
        resetRecordingUi();
        return;
      }

      if (Platform.OS !== 'web') {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
      }
      if (!mountedRef.current || !wantRecordingRef.current) {
        if (Platform.OS !== 'web') {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
            () => {}
          );
        }
        resetRecordingUi();
        return;
      }

      await recorder.prepareToRecordAsync();
      if (!mountedRef.current || !wantRecordingRef.current) {
        await recorder.stop().catch(() => {});
        await discardTempAudioClip(recorder.uri);
        if (Platform.OS !== 'web') {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
            () => {}
          );
        }
        resetRecordingUi();
        return;
      }

      recorder.record();
      const startedStatus = recorder.getStatus();
      if (Platform.OS !== 'web' && !startedStatus.isRecording) {
        throw new Error('Native recorder did not enter recording state');
      }

      recordingActiveRef.current = true;
      recordingStartedAtRef.current = Date.now();
      maxDurationMsRef.current = 0;
      setElapsedSec(0);
      setMeterLevel(0.08);

      statusTimerRef.current = setInterval(() => {
        if (!mountedRef.current || !recordingActiveRef.current) return;
        const status = recorder.getStatus();
        const rawDuration = Number.isFinite(status.durationMillis)
          ? (status.durationMillis ?? 0)
          : 0;
        const wallElapsed = Date.now() - recordingStartedAtRef.current;
        const durationMs = Math.max(rawDuration, wallElapsed);
        if (durationMs > maxDurationMsRef.current) {
          maxDurationMsRef.current = durationMs;
        }
        setElapsedSec(Math.floor(durationMs / 1000));

        if (typeof status.metering === 'number' && Number.isFinite(status.metering)) {
          const normalized = Math.min(1, Math.max(0.08, (status.metering + 60) / 60));
          setMeterLevel(normalized);
        }

        if (durationMs >= MAX_RECORDING_SECONDS * 1000 && !busyRef.current) {
          stopRecordingRef.current();
        }
      }, 250);
    } catch (err) {
      wantRecordingRef.current = false;
      if (mountedRef.current) {
        resetRecordingUi();
        const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
        setError(`Could not start audio recording${detail}.`);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsRecorderBusy(false);
    }
  };

  const handleHoldStart = () => {
    if (busyRef.current || recordingActiveRef.current || isSaving) return;
    if (Platform.OS === 'android') {
      Vibration.vibrate(10);
    }
    wantRecordingRef.current = true;
    recordingModeRef.current = 'holding';
    setRecordingMode('holding');
    startRecording();
  };

  const handleHoldLock = () => {
    if (!wantRecordingRef.current && !recordingActiveRef.current) return;
    if (Platform.OS === 'android') {
      Vibration.vibrate(15);
    }
    recordingModeRef.current = 'locked';
    setRecordingMode('locked');
  };

  const handleHoldCancel = () => {
    if (Platform.OS === 'android') {
      Vibration.vibrate(15);
    }
    cancelRecording();
  };

  const handleHoldRelease = () => {
    if (recordingModeRef.current === 'locked') return;
    wantRecordingRef.current = false;
    if (!recordingActiveRef.current) {
      resetRecordingUi();
      flashHint('Hold mic to record - swipe up to lock');
      return;
    }
    const heldMs = Math.max(maxDurationMsRef.current, Date.now() - recordingStartedAtRef.current);
    if (heldMs < 500) {
      cancelRecording('Hold mic a bit longer to record');
      return;
    }
    stopRecording();
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
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 24, flexGrow: 1 }}
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

            {error ? (
              <View className="gap-2">
                <ErrorBanner>{error}</ErrorBanner>
                {error.includes('Microphone permission') && Platform.OS !== 'web' ? (
                  <Button
                    label="Open app settings"
                    icon="sliders"
                    variant="secondary"
                    onPress={() => Linking.openSettings()}
                  />
                ) : error.includes('Vault') ? (
                  <Button
                    label="Open Vault"
                    icon="archive"
                    variant="secondary"
                    onPress={() => router.navigate('./vault')}
                  />
                ) : null}
              </View>
            ) : null}

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
                  Hold the mic button below to record (swipe up to lock), or type a note. Your phone
                  transcribes speech and pulls out tasks offline.
                </Text>
              </Panel>
            )}
          </View>
        </ScrollView>

        <CaptureComposer
          recordingMode={recordingMode}
          elapsedSec={elapsedSec}
          maxSec={MAX_RECORDING_SECONDS}
          meterLevel={meterLevel}
          draftText={draftText}
          onChangeDraftText={setDraftText}
          onSaveText={handleSaveTextNote}
          onHoldStart={handleHoldStart}
          onHoldLock={handleHoldLock}
          onHoldCancel={handleHoldCancel}
          onHoldRelease={handleHoldRelease}
          onLockedStop={stopRecording}
          onLockedCancel={() => cancelRecording()}
          isSaving={isSaving}
          isBusy={isRecorderBusy}
          hint={holdHint}
        />
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
