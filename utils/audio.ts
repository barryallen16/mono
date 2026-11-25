import {
  AudioPlayer,
  AudioStatus,
  createAudioPlayer,
  PLAYBACK_STATUS_UPDATE,
  setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { Share } from 'react-native';

import { formatLocalDate, MonoNote } from './notes';

const RECORDINGS_SUBDIR = 'recordings/';

let clipSeq = 0;
let activeToken = 0;
let activeStopper: (() => Promise<void>) | null = null;

export async function persistAudioClip(tempUri: string | null): Promise<string | null> {
  if (!tempUri) return null;

  const sourceUri = tempUri.startsWith('/') ? `file://${tempUri}` : tempUri;
  const baseDir = FileSystem.documentDirectory;
  if (!baseDir) return sourceUri;

  const recordingsDir = `${baseDir}${RECORDINGS_SUBDIR}`;
  await FileSystem.makeDirectoryAsync(recordingsDir, { intermediates: true });
  const extMatch = sourceUri.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0] : '.m4a';
  clipSeq += 1;
  const targetUri = `${recordingsDir}clip-${Date.now()}-${clipSeq}${ext}`;

  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export async function discardTempAudioClip(uri: string | null): Promise<void> {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function deleteAllSavedAudioFiles(): Promise<void> {
  const baseDir = FileSystem.documentDirectory;
  if (!baseDir) return;
  await FileSystem.deleteAsync(`${baseDir}${RECORDINGS_SUBDIR}`, { idempotent: true }).catch(
    () => {}
  );
}

export async function stopActivePlayback(): Promise<void> {
  activeToken += 1;
  const stopper = activeStopper;
  activeStopper = null;
  if (stopper) {
    await stopper().catch(() => {});
  }
}

export async function startAudioPlayback(
  uri: string,
  onProgress: (state: { isPlaying: boolean; positionSec: number; durationSec: number }) => void,
  onFinished: () => void
): Promise<() => Promise<void>> {
  const prevStopper = activeStopper;
  const token = ++activeToken;
  let settled = false;
  let subscription: { remove: () => void } | null = null;
  let player: AudioPlayer | null = null;
  let hasStarted = false;

  const cleanup = async () => {
    if (settled) return;
    settled = true;
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
    if (activeStopper === stop) {
      activeStopper = null;
    }
    if (player) {
      const target = player;
      player = null;
      try {
        target.pause();
      } catch {}
      try {
        target.remove();
      } catch {}
    }
  };

  const stop = async () => {
    await cleanup();
    onFinished();
  };

  activeStopper = stop;

  if (prevStopper) {
    await prevStopper().catch(() => {});
  }

  if (token !== activeToken || settled) {
    await cleanup();
    return stop;
  }

  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
  }).catch(() => {});

  if (token !== activeToken || settled) {
    await cleanup();
    return stop;
  }

  const handleStatus = (status: AudioStatus) => {
    if (settled || !status.isLoaded) return;
    const rawDuration = status.duration ?? 0;
    const rawPosition = status.currentTime ?? 0;
    const durationSec =
      Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : 0;
    const positionSec =
      Number.isFinite(rawPosition) && rawPosition > 0 ? Math.floor(rawPosition) : 0;

    if (status.playing || rawPosition > 0) {
      hasStarted = true;
    }

    if (status.didJustFinish || (!status.playing && hasStarted)) {
      stop();
      return;
    }

    onProgress({
      isPlaying: true,
      positionSec,
      durationSec,
    });
  };

  try {
    const created = createAudioPlayer({ uri }, 250);
    if (token !== activeToken || settled) {
      try {
        created.remove();
      } catch {}
      await cleanup();
      return stop;
    }
    player = created;
    subscription = created.addListener(PLAYBACK_STATUS_UPDATE, handleStatus);
    created.play();
  } catch (err) {
    await cleanup();
    throw err;
  }

  return stop;
}

export async function exportNotesToFile(
  notes: MonoNote[]
): Promise<'saved' | 'shared' | 'cancelled'> {
  const payload = JSON.stringify(notes, null, 2);

  if (FileSystem.StorageAccessFramework) {
    const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permissions.granted) {
      return 'cancelled';
    }
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      `mono-export-${formatLocalDate()}`,
      'application/json'
    );
    try {
      await FileSystem.writeAsStringAsync(fileUri, payload);
      return 'saved';
    } catch (err) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      throw err;
    }
  }

  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  const fileUri = baseDir ? `${baseDir}mono-export.json` : undefined;
  if (fileUri) {
    await FileSystem.writeAsStringAsync(fileUri, payload);
  }
  await Share.share({
    title: 'mono-export.json',
    ...(fileUri ? { url: fileUri } : {}),
    message: payload,
  });
  return 'shared';
}
