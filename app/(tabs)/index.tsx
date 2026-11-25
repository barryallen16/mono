import { Audio } from 'expo-av';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioClipBar, NoteCard } from '~/components/note-card';
import { PixelIcon } from '~/components/pixel-icon';
import {
  Button,
  ErrorBanner,
  Field,
  Panel,
  ScreenHeader,
  Tappable,
  tabularNums,
} from '~/components/ui';
import { discardTempAudioClip, stopActivePlayback } from '~/utils/audio';
import {
  CactusStatus,
  getCactusStatus,
  isCactusAvailable,
  subscribeCactusProgress,
} from '~/utils/cactus';
import { createNote, listNotes, MonoNote, toggleActionItem } from '~/utils/db';
import { formatDuration } from '~/utils/notes';

const MAX_RECORDING_SECONDS = 120;

interface PendingClip {
  uri: string;
  durationSec: number;
}

function getRecordingOptions(): Audio.RecordingOptions {
  if (Platform.OS !== 'web' || typeof MediaRecorder === 'undefined') {
    return Audio.RecordingOptionsPresets.HIGH_QUALITY;
  }
  const webOptions: Audio.RecordingOptionsWeb = {};
  if (typeof MediaRecorder.isTypeSupported === 'function') {
    if (MediaRecorder.isTypeSupported('audio/webm')) {
      webOptions.mimeType = 'audio/webm';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      webOptions.mimeType = 'audio/mp4';
    }
  }
  return {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    web: webOptions,
  };
}

export default function CaptureScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isRecorderBusy, setIsRecorderBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pendingClip, setPendingClip] = useState<PendingClip | null>(null);
  const [draftText, setDraftText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestNote, setLatestNote] = useState<MonoNote | null>(null);
  const [cactusStatus, setCactusStatus] = useState<CactusStatus | null>(null);
  const [modelProgressText, setModelProgressText] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ticksRef = useRef(0);
  const pendingClipRef = useRef<PendingClip | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  pendingClipRef.current = pendingClip;

  const refreshLatest = useCallback(async () => {
    try {
      const notes = await listNotes();
      if (mountedRef.current) setLatestNote(notes[0] ?? null);
    } catch {
      if (mountedRef.current) setError('Could not read local database.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLatest();
      getCactusStatus()
        .then((status) => {
          if (mountedRef.current) setCactusStatus(status);
        })
        .catch(() => {});
      return () => {
        stopActivePlayback();
      };
    }, [refreshLatest])
  );

  useEffect(() => {
    const sub = subscribeCactusProgress((ev) => {
      if (!mountedRef.current) return;
      if (ev.phase === 'downloading') {
        const pct = Math.round(ev.progress * 100);
        setModelProgressText(`${ev.model.toUpperCase()} ${pct}%`);
      } else {
        setModelProgressText(null);
        getCactusStatus()
          .then((status) => {
            if (mountedRef.current) setCactusStatus(status);
          })
          .catch(() => {});
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
      if (timerRef.current) clearInterval(timerRef.current);
      const active = recordingRef.current;
      recordingRef.current = null;
      if (active) {
        active
          .stopAndUnloadAsync()
          .then(() => discardTempAudioClip(active.getURI()))
          .catch(() => {});
      }
      discardTempAudioClip(pendingClipRef.current?.uri ?? null);
      stopActivePlayback();
    };
  }, []);

  const stopRecording = useCallback(async () => {
    if (busyRef.current || !recordingRef.current) return;
    busyRef.current = true;
    setIsRecorderBusy(true);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const active = recordingRef.current;
    try {
      const status = await active.stopAndUnloadAsync();
      const uri = active.getURI();
      recordingRef.current = null;

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
      const rawDuration = status.durationMillis;
      const statusSec = Number.isFinite(rawDuration) ? Math.round((rawDuration ?? 0) / 1000) : 0;
      const durationSec = Math.max(1, ticksRef.current, statusSec);

      if (uri) {
        await discardTempAudioClip(pendingClipRef.current?.uri ?? null);
        setPendingClip({ uri, durationSec });
      } else {
        setError('Recording finished without audio output.');
      }
    } catch {
      recordingRef.current = null;
      if (mountedRef.current) {
        setIsRecording(false);
        setError('Could not finalize audio clip.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsRecorderBusy(false);
    }
  }, []);

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
      ticksRef.current = 0;
      setIsRecording(true);
      setElapsedSec(0);

      timerRef.current = setInterval(() => {
        ticksRef.current += 1;
        setElapsedSec(ticksRef.current);
        if (ticksRef.current >= MAX_RECORDING_SECONDS) {
          stopRecording();
        }
      }, 1000);
    } catch {
      if (mountedRef.current) {
        setError('Could not start audio recording.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsRecorderBusy(false);
    }
  };

  const handleDiscardClip = async () => {
    if (!pendingClip || isSaving || isRecorderBusy || isRecording) return;
    await stopActivePlayback();
    await discardTempAudioClip(pendingClip.uri);
    setPendingClip(null);
  };

  const handleSave = async () => {
    const trimmed = draftText.trim();
    if ((!trimmed && !pendingClip) || isSaving || isRecorderBusy || isRecording) return;

    Keyboard.dismiss();
    await stopActivePlayback();
    setIsSaving(true);
    setError(null);
    const clipToSave = pendingClip;
    try {
      const saved = await createNote(
        trimmed,
        clipToSave?.durationSec ?? 0,
        clipToSave?.uri ?? null
      );
      if (clipToSave?.uri && saved.audioUri !== clipToSave.uri) {
        await discardTempAudioClip(clipToSave.uri);
      }
      if (!mountedRef.current) return;
      setLatestNote(saved);
      setDraftText('');
      setPendingClip(null);
      getCactusStatus()
        .then((status) => {
          if (mountedRef.current) setCactusStatus(status);
        })
        .catch(() => {});
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
    const updated = await toggleActionItem(noteId, actionId);
    if (updated && mountedRef.current) setLatestNote(updated);
  };

  const displaySeconds = isRecording ? elapsedSec : (pendingClip?.durationSec ?? 0);
  const statusPillLabel = isRecording
    ? formatDuration(elapsedSec)
    : modelProgressText
      ? modelProgressText
      : cactusStatus?.supported
        ? cactusStatus.whistleLoaded || cactusStatus.needleLoaded
          ? 'CACTUS LIVE'
          : cactusStatus.whistleCached && cactusStatus.needleCached
            ? 'CACTUS READY'
            : 'ON-DEVICE'
        : isCactusAvailable()
          ? 'REGEX FALLBACK'
          : 'LOCAL';

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="mono"
        subtitle="Offline voice log"
        right={
          <View className="flex-row items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5">
            <View className={`h-2 w-2 rounded-sm ${isRecording ? 'bg-danger' : 'bg-accent'}`} />
            <Text className="font-mono text-xs text-ink" style={tabularNums} numberOfLines={1}>
              {statusPillLabel}
            </Text>
          </View>
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled">
          <View className="w-full max-w-2xl gap-4 self-center">
            <Panel className="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-pixel text-lg text-ink">
                  {isRecording ? 'Recording...' : 'New entry'}
                </Text>
                <Text className="font-mono text-xs text-muted" style={tabularNums}>
                  {formatDuration(displaySeconds)} / 02:00
                </Text>
              </View>

              <Button
                label={isRecording ? 'Stop recording' : 'Record voice'}
                icon={isRecording ? 'square' : 'mic'}
                variant={isRecording ? 'danger' : 'primary'}
                disabled={isRecorderBusy || isSaving}
                onPress={isRecording ? stopRecording : startRecording}
              />

              {pendingClip && !isRecording ? (
                <View className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <View className="flex-1">
                      <AudioClipBar
                        uri={pendingClip.uri}
                        durationSec={pendingClip.durationSec}
                        label="Play recorded clip"
                        onError={setError}
                      />
                    </View>
                    <Tappable
                      onPress={handleDiscardClip}
                      disabled={isSaving || isRecorderBusy}
                      accessibilityLabel="Discard recorded clip"
                      className={`h-10 w-10 items-center justify-center rounded-md border border-line bg-bg ${
                        isSaving || isRecorderBusy ? 'opacity-40' : ''
                      }`}>
                      <PixelIcon name="close" size={16} color="#fca5a5" />
                    </Tappable>
                  </View>
                  <Text className="font-mono text-xs text-muted">
                    Clip ready ({formatDuration(pendingClip.durationSec)}). Add optional notes below
                    or save directly.
                  </Text>
                </View>
              ) : null}

              <Field
                placeholder="Optional: type a note, todo, or tag context..."
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
                  label={
                    isSaving
                      ? isCactusAvailable()
                        ? pendingClip
                          ? 'Transcribing...'
                          : 'Extracting...'
                        : 'Saving...'
                      : 'Save entry'
                  }
                  icon="check"
                  variant="secondary"
                  onPress={handleSave}
                  loading={isSaving}
                  disabled={(!draftText.trim() && !pendingClip) || isRecording || isRecorderBusy}
                />
              </View>
            </Panel>

            {error ? <ErrorBanner>{error}</ErrorBanner> : null}

            {latestNote ? (
              <NoteCard
                key={latestNote.id}
                note={latestNote}
                onToggleAction={handleToggleAction}
                onAudioError={setError}
              />
            ) : (
              <Panel className="items-start gap-2">
                <Text className="font-pixel text-base text-ink">No entries yet</Text>
                <Text className="font-mono text-xs leading-5 text-muted">
                  Record a voice clip or type a note above. Audio and tasks stay on this device.
                </Text>
              </Panel>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
