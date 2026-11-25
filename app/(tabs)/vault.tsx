import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixelIcon } from '~/components/pixel-icon';
import { Button, ErrorBanner, Panel, ScreenHeader, Sheet, tabularNums } from '~/components/ui';
import { exportNotesToFile } from '~/utils/audio';
import {
  CactusStatus,
  clearCactusModels,
  getCactusStatus,
  prepareCactusModels,
  subscribeCactusProgress,
} from '~/utils/cactus';
import { computeStreak, formatLocalDate, listNotes, MonoNote, wipeAllNotes } from '~/utils/db';

interface ModelProgressState {
  label: string;
  valueLabel: string;
  pct: number | null;
}

function formatMb(bytes: number): string {
  if (!bytes) return 'not cached';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function last14Days(): string[] {
  const days: string[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    days.push(formatLocalDate(d));
  }
  return days;
}

const SUPPORT_URL = 'https://github.com/barryallen16/mono/issues';

const EXPORT_MESSAGES: Record<'saved' | 'shared' | 'cancelled', string> = {
  saved: 'Export saved to selected folder.',
  shared: 'Export ready to share.',
  cancelled: 'Export cancelled.',
};

export default function VaultScreen() {
  const router = useRouter();
  const [notes, setNotes] = useState<MonoNote[]>([]);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showLegalSheet, setShowLegalSheet] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isModelBusy, setIsModelBusy] = useState(false);
  const [modelProgress, setModelProgress] = useState<ModelProgressState | null>(null);
  const [cactusStatus, setCactusStatus] = useState<CactusStatus | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
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
        if (ev.progress >= 0) {
          const pct = Math.min(100, Math.max(0, Math.round(ev.progress * 100)));
          setModelProgress({
            label: `Downloading ${ev.model}`,
            valueLabel: `${pct}%`,
            pct,
          });
        } else {
          const mb = (ev.receivedBytes / (1024 * 1024)).toFixed(1);
          setModelProgress({
            label: `Downloading ${ev.model}`,
            valueLabel: `${mb} MB`,
            pct: null,
          });
        }
      } else if (ev.phase === 'loading') {
        setModelProgress({
          label: `Loading ${ev.model}...`,
          valueLabel: 'Loading...',
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

  const handlePrepareModels = async () => {
    setIsModelBusy(true);
    setError(null);
    setCacheNotice(null);
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
    setCacheNotice(null);
    try {
      const next = await clearCactusModels();
      setCactusStatus(next);
      if (next?.whistleLoaded || next?.needleLoaded) {
        setCacheNotice('Cache cleared (restart app to unload RAM)');
      } else {
        setCacheNotice('Model cache cleared.');
      }
    } catch {
      setError('Could not clear cached models.');
    } finally {
      setIsModelBusy(false);
    }
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setError(null);
    setExportNotice(null);
    try {
      const outcome = await exportNotesToFile(notes);
      setExportNotice(EXPORT_MESSAGES[outcome]);
    } catch {
      setError('Could not export notes.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleWipeConfirm = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      await wipeAllNotes();
      setNotes([]);
      setShowWipeConfirm(false);
    } catch {
      setError('Could not update local storage.');
    } finally {
      setIsBusy(false);
    }
  };

  const streak = computeStreak(notes);
  const openTasks = notes.reduce(
    (sum, note) => sum + note.actionItems.filter((item) => !item.done).length,
    0
  );
  const activeDates = new Set(notes.map((n) => n.localDate));
  const days = last14Days();
  const storageLabel = 'expo-sqlite (on-device)';

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="Vault"
        subtitle="Cadence, runtime, and data export"
        right={
          <Text className="font-mono text-xs text-muted" style={tabularNums}>
            {notes.length} {notes.length === 1 ? 'entry' : 'entries'}
          </Text>
        }
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View className="w-full max-w-2xl gap-4 self-center">
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}

          <Panel className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-pixel text-base text-ink">Cadence</Text>
              <View className="flex-row items-center gap-1.5 rounded-md border border-line bg-bg px-2.5 py-1">
                <PixelIcon name="zap" size={16} color="#9d91cc" />
                <Text className="font-pixel text-sm text-ink" style={tabularNums}>
                  {streak}d
                </Text>
              </View>
            </View>

            <View className="flex-row justify-between gap-1.5">
              {days.map((day) => {
                const filled = activeDates.has(day);
                return (
                  <View
                    key={day}
                    className={`h-5 flex-1 rounded-sm border ${
                      filled ? 'border-accent bg-accent' : 'border-line bg-bg'
                    }`}
                  />
                );
              })}
            </View>

            <View className="flex-row justify-between">
              <Text className="font-mono text-xs text-muted" style={tabularNums}>
                {days[0]}
              </Text>
              <Text className="font-mono text-xs text-muted" style={tabularNums}>
                {days[days.length - 1]}
              </Text>
            </View>

            <View className="flex-row gap-3 border-t border-line pt-2.5">
              <View className="flex-1 gap-0.5">
                <Text className="font-mono text-xs text-muted">Entries</Text>
                <Text className="font-pixel text-xl text-ink" style={tabularNums}>
                  {notes.length}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-mono text-xs text-muted">Open tasks</Text>
                <Text className="font-pixel text-xl text-ink" style={tabularNums}>
                  {openTasks}
                </Text>
              </View>
            </View>
          </Panel>

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
                  : cactusStatus
                    ? `Unsupported ABI (${cactusStatus.abi})`
                    : 'Cactus runtime unavailable'}
              </Text>
            </View>
            {cactusStatus?.supported ? (
              <>
                <View className="flex-row justify-between border-t border-line pt-2">
                  <Text className="font-mono text-xs text-muted">Whistle STT</Text>
                  <Text className="font-mono text-xs text-ink" style={tabularNums}>
                    {cactusStatus.whistleLoaded ? 'loaded - ' : ''}
                    {formatMb(cactusStatus.whistleBytes)}
                  </Text>
                </View>
                <View className="flex-row justify-between border-t border-line pt-2">
                  <Text className="font-mono text-xs text-muted">Needle 3</Text>
                  <Text className="font-mono text-xs text-ink" style={tabularNums}>
                    {cactusStatus.needleLoaded ? 'loaded - ' : ''}
                    {formatMb(cactusStatus.needleBytes)}
                  </Text>
                </View>
                {modelProgress ? (
                  <View className="gap-1.5 pt-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-mono text-xs text-accent">{modelProgress.label}</Text>
                      <Text className="font-mono text-xs text-muted" style={tabularNums}>
                        {modelProgress.valueLabel}
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
                  </View>
                ) : null}
                {cacheNotice ? (
                  <View className="rounded-md border border-line bg-bg px-3 py-2">
                    <Text className="font-mono text-xs text-muted">{cacheNotice}</Text>
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
            {exportNotice ? (
              <View className="rounded-md border border-line bg-bg px-3 py-2">
                <Text className="font-mono text-xs text-accent">{exportNotice}</Text>
              </View>
            ) : null}
            <Button
              label="Export JSON"
              icon="download"
              variant="secondary"
              loading={isExporting}
              onPress={handleExport}
              disabled={notes.length === 0 || isExporting}
            />
            <Button
              label="View onboarding"
              icon="sliders"
              variant="ghost"
              onPress={() => router.push('/onboarding')}
            />
          </Panel>

          <Panel className="gap-2.5">
            <Text className="font-pixel text-base text-ink">Support & legal</Text>
            <Button
              label="Send feedback or report issue"
              icon="info-box"
              variant="secondary"
              onPress={() =>
                Linking.openURL(SUPPORT_URL).catch(() => setError('Could not open support link.'))
              }
            />
            <Button
              label="Privacy & terms"
              icon="lock"
              variant="ghost"
              onPress={() => setShowLegalSheet(true)}
            />
          </Panel>

          <Panel className="gap-2.5 border-danger/30">
            <Text className="font-pixel text-base text-red-300">Danger zone</Text>
            <Button
              label="Wipe all notes"
              icon="trash"
              variant="danger"
              onPress={() => setShowWipeConfirm(true)}
              disabled={notes.length === 0}
            />
          </Panel>

          <Text className="text-center font-mono text-xs text-muted" style={tabularNums}>
            mono v{Constants.expoConfig?.version ?? '1.0.1'}
          </Text>
        </View>
      </ScrollView>

      <Sheet
        visible={showLegalSheet}
        onClose={() => setShowLegalSheet(false)}
        title="Privacy & terms">
        <View className="gap-3">
          <Text className="font-mono text-xs leading-5 text-muted">
            Privacy: mono records audio and stores notes, transcripts, and tasks locally on your
            device. Speech and note models run offline on-device and are downloaded once from
            Hugging Face when prepared.
          </Text>
          <Text className="font-mono text-xs leading-5 text-muted">
            Terms: You own your exported notes and audio clips. Software is provided as-is without
            warranty; back up important notes with Export JSON.
          </Text>
          <Button label="Close" variant="secondary" onPress={() => setShowLegalSheet(false)} />
        </View>
      </Sheet>

      <Sheet
        visible={showWipeConfirm}
        onClose={() => !isBusy && setShowWipeConfirm(false)}
        title="Wipe all local notes?">
        <View className="gap-4">
          <Text className="font-mono text-xs leading-5 text-muted">
            This permanently removes every note and voice clip on this device.
          </Text>
          <View className="gap-2.5">
            <Button
              label="Wipe all"
              icon="trash"
              variant="danger"
              loading={isBusy}
              onPress={handleWipeConfirm}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={isBusy}
              onPress={() => setShowWipeConfirm(false)}
            />
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
