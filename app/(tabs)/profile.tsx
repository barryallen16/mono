import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixelIcon } from '~/components/pixel-icon';
import {
  Button,
  ErrorBanner,
  Panel,
  ScreenHeader,
  Sheet,
  Tappable,
  tabularNums,
} from '~/components/ui';
import {
  CactusStatus,
  clearCactusModels,
  getCactusStatus,
  prepareCactusModels,
  subscribeCactusProgress,
} from '~/utils/cactus';
import { deleteNote, listNotes, MonoNote, wipeAllNotes } from '~/utils/db';
import { formatDuration } from '~/utils/notes';

type ConfirmAction = { type: 'delete'; note: MonoNote } | { type: 'wipe' } | null;

function formatMb(bytes: number): string {
  if (!bytes) return 'not cached';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VaultScreen() {
  const router = useRouter();
  const [notes, setNotes] = useState<MonoNote[]>([]);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isModelBusy, setIsModelBusy] = useState(false);
  const [modelProgress, setModelProgress] = useState<{ label: string; pct: number } | null>(null);
  const [cactusStatus, setCactusStatus] = useState<CactusStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [items, status] = await Promise.all([listNotes(), getCactusStatus().catch(() => null)]);
      setNotes(items);
      setCactusStatus(status);
    } catch {
      setError('Could not load saved entries.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    const sub = subscribeCactusProgress((ev) => {
      if (ev.phase === 'downloading') {
        const pct = Math.round(ev.progress * 100);
        setModelProgress({ label: `Downloading ${ev.model}`, pct });
      } else {
        setModelProgress(null);
      }
    });
    return () => {
      sub?.remove();
    };
  }, []);

  const handlePrepareModels = async () => {
    setIsModelBusy(true);
    setError(null);
    try {
      const next = await prepareCactusModels();
      setCactusStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download Cactus models.');
    } finally {
      setIsModelBusy(false);
      setModelProgress(null);
    }
  };

  const handleClearModels = async () => {
    setIsModelBusy(true);
    setError(null);
    try {
      const next = await clearCactusModels();
      setCactusStatus(next);
    } catch {
      setError('Could not clear cached models.');
    } finally {
      setIsModelBusy(false);
    }
  };

  const handleExport = async () => {
    setError(null);
    const payload = JSON.stringify(notes, null, 2);

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mono-export.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        setError('Could not download export file.');
      }
      return;
    }

    try {
      await Share.share({
        title: 'mono-export.json',
        message: payload,
      });
    } catch {
      setError('Could not share export.');
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      if (confirmAction.type === 'delete') {
        await deleteNote(confirmAction.note.id);
        setNotes((prev) => prev.filter((n) => n.id !== confirmAction.note.id));
      } else {
        await wipeAllNotes();
        setNotes([]);
      }
      setConfirmAction(null);
    } catch {
      setError('Could not update local storage.');
    } finally {
      setIsBusy(false);
    }
  };

  const storageLabel = Platform.OS === 'web' ? 'localStorage (browser)' : 'expo-sqlite (on-device)';

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="Vault"
        subtitle="Local storage and data export"
        right={
          <Text className="font-mono text-xs text-muted" style={tabularNums}>
            {notes.length} {notes.length === 1 ? 'entry' : 'entries'}
          </Text>
        }
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View className="w-full max-w-2xl gap-4 self-center">
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}

          <Panel className="gap-2">
            <Text className="font-pixel text-base text-ink">Runtime</Text>
            <View className="flex-row justify-between border-t border-line pt-2">
              <Text className="font-mono text-xs text-muted">Storage</Text>
              <Text className="font-mono text-xs text-ink">{storageLabel}</Text>
            </View>
            <View className="flex-row justify-between border-t border-line pt-2">
              <Text className="font-mono text-xs text-muted">Inference</Text>
              <Text className="font-mono text-xs text-ink">
                {cactusStatus?.supported
                  ? `Cactus 4.1.4 (${cactusStatus.abi})`
                  : Platform.OS === 'android'
                    ? cactusStatus
                      ? `Unsupported ABI (${cactusStatus.abi})`
                      : 'Expo Go (needs EAS APK build)'
                    : 'Regex fallback (Android native only)'}
              </Text>
            </View>
            {cactusStatus?.supported ? (
              <>
                <View className="flex-row justify-between border-t border-line pt-2">
                  <Text className="font-mono text-xs text-muted">Whistle STT</Text>
                  <Text className="font-mono text-xs text-ink" style={tabularNums}>
                    {cactusStatus.whistleLoaded ? 'loaded · ' : ''}
                    {formatMb(cactusStatus.whistleBytes)}
                  </Text>
                </View>
                <View className="flex-row justify-between border-t border-line pt-2">
                  <Text className="font-mono text-xs text-muted">Needle 3</Text>
                  <Text className="font-mono text-xs text-ink" style={tabularNums}>
                    {cactusStatus.needleLoaded ? 'loaded · ' : ''}
                    {formatMb(cactusStatus.needleBytes)}
                  </Text>
                </View>
                {modelProgress ? (
                  <View className="gap-1.5 pt-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-mono text-xs text-accent">{modelProgress.label}</Text>
                      <Text className="font-mono text-xs text-muted" style={tabularNums}>
                        {modelProgress.pct}%
                      </Text>
                    </View>
                    <View className="h-2 overflow-hidden rounded-sm border border-line bg-bg">
                      <View
                        className="h-full bg-accent"
                        style={{ width: `${modelProgress.pct}%` }}
                      />
                    </View>
                  </View>
                ) : null}
                <View className="mt-1 gap-2">
                  <Button
                    label={
                      cactusStatus.whistleCached && cactusStatus.needleCached
                        ? 'Warm up on-device models'
                        : 'Download Whistle + Needle 3 (~52 MB)'
                    }
                    icon="zap"
                    variant="secondary"
                    loading={isModelBusy}
                    onPress={handlePrepareModels}
                  />
                  {cactusStatus.whistleCached || cactusStatus.needleCached ? (
                    <Button
                      label="Clear model cache"
                      icon="trash"
                      variant="ghost"
                      disabled={isModelBusy}
                      onPress={handleClearModels}
                    />
                  ) : null}
                </View>
              </>
            ) : null}
          </Panel>

          <Panel className="gap-2.5">
            <Text className="font-pixel text-base text-ink">Data</Text>
            <Button
              label="Export JSON"
              icon="download"
              variant="secondary"
              onPress={handleExport}
              disabled={notes.length === 0}
            />
            <Button
              label="View onboarding"
              icon="sliders"
              variant="ghost"
              onPress={() => router.push('/onboarding')}
            />
            <Button
              label="Wipe all notes"
              icon="trash"
              variant="danger"
              onPress={() => setConfirmAction({ type: 'wipe' })}
              disabled={notes.length === 0}
            />
          </Panel>

          <Panel className="gap-3">
            <Text className="font-pixel text-base text-ink">Saved entries</Text>
            {notes.length === 0 ? (
              <Text className="font-mono text-xs text-muted">Nothing stored yet.</Text>
            ) : (
              notes.map((note) => (
                <View
                  key={note.id}
                  className="flex-row items-start justify-between gap-3 border-t border-line pt-3">
                  <View className="flex-1">
                    <Text className="font-mono-medium text-xs text-ink">{note.title}</Text>
                    <Text className="mt-0.5 font-mono text-xs text-muted" style={tabularNums}>
                      {note.audioUri && note.durationSec > 0
                        ? `${note.localDate} · ${formatDuration(note.durationSec)}`
                        : note.localDate}
                    </Text>
                  </View>
                  <Tappable
                    onPress={() => setConfirmAction({ type: 'delete', note })}
                    accessibilityLabel={`Delete ${note.title}`}
                    className="h-10 w-10 items-center justify-center rounded-md border border-line bg-bg">
                    <PixelIcon name="trash" size={16} color="#fca5a5" />
                  </Tappable>
                </View>
              ))
            )}
          </Panel>
        </View>
      </ScrollView>

      <Sheet
        visible={confirmAction !== null}
        onClose={() => !isBusy && setConfirmAction(null)}
        title={confirmAction?.type === 'wipe' ? 'Wipe all local notes?' : 'Delete entry?'}>
        <View className="gap-4">
          <Text className="font-mono text-xs leading-5 text-muted">
            {confirmAction?.type === 'wipe'
              ? 'This permanently removes every note and voice clip on this device.'
              : 'This removes the entry and its saved audio clip from local storage.'}
          </Text>
          <View className="gap-2.5">
            <Button
              label={confirmAction?.type === 'wipe' ? 'Wipe all' : 'Delete'}
              icon="trash"
              variant="danger"
              loading={isBusy}
              onPress={handleConfirm}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={isBusy}
              onPress={() => setConfirmAction(null)}
            />
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
