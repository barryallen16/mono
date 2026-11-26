import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  AudioState,
  combineDraftAndTranscript,
  formatLocalDate,
  mergeCactusNoteFields,
  SttEngine,
} from './notes';

import {
  CactusProgressEvent,
  CactusStatus,
  clearCactusModels,
  extractWithNeedle3,
  getCactusStatus,
  prepareCactusModels,
  subscribeCactusProgress,
  transcribeWithWhistle,
} from '~/modules/cactus-native/src';

export type { CactusProgressEvent, CactusStatus };
export { clearCactusModels, getCactusStatus, prepareCactusModels, subscribeCactusProgress };

const WHISTLE_KEYWORDS_KEY = 'whistle_keywords_v1';

export function normalizeWhistleKeywords(value: string): string {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

export async function getWhistleKeywords(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(WHISTLE_KEYWORDS_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function setWhistleKeywords(value: string): Promise<string> {
  const normalized = normalizeWhistleKeywords(value);
  await AsyncStorage.setItem(WHISTLE_KEYWORDS_KEY, normalized);
  return normalized;
}

export async function processNoteWithCactus(
  draftText: string,
  durationSec: number,
  savedAudioUri: string | null,
  localDate = formatLocalDate(),
  options?: { existingTranscript?: string; skipStt?: boolean; keywords?: string | null }
) {
  let heardText = '';
  let audioState: AudioState = 'none';
  let sttEngine: SttEngine = 'none';
  let lastError: string | null = null;

  const useExistingTranscript = Boolean(options?.skipStt && options.existingTranscript?.trim());
  let status: CactusStatus | null = null;
  if (savedAudioUri || draftText.trim() || useExistingTranscript) {
    try {
      status = await getCactusStatus();
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Failed to inspect Cactus runtime.';
    }
  }

  if (useExistingTranscript) {
    heardText = options?.existingTranscript?.trim() ?? '';
    audioState = savedAudioUri ? 'done' : 'none';
    sttEngine = savedAudioUri ? 'whistle' : 'none';
  } else if (savedAudioUri) {
    if (!status?.supported) {
      audioState = 'failed';
      sttEngine = 'none';
      if (!lastError) {
        lastError = 'Cactus native runtime is unavailable on this device.';
      }
    } else if (!status.whistleCached && !status.whistleLoaded) {
      audioState = 'pending';
      sttEngine = 'none';
      lastError = 'Speech model not downloaded yet. Tap Retry once cached.';
    } else {
      try {
        const cleanKeywords = options?.keywords ? normalizeWhistleKeywords(options.keywords) : '';
        const stt = await transcribeWithWhistle(savedAudioUri, 'en', cleanKeywords || null);
        heardText = stt?.text ?? '';
        audioState = 'done';
        sttEngine = 'whistle';
      } catch (err) {
        heardText = '';
        audioState = 'failed';
        sttEngine = 'none';
        lastError = err instanceof Error ? err.message : 'Speech transcription failed.';
      }
    }
  }

  const finalTranscript = useExistingTranscript
    ? heardText
    : combineDraftAndTranscript(draftText, heardText);
  let extracted = null;

  if (finalTranscript && status?.supported) {
    if (!status.needleCached && !status.needleLoaded) {
      if (!lastError) {
        lastError = 'Note extractor model not downloaded yet. Tap Retry once cached.';
      }
    } else {
      try {
        extracted = await extractWithNeedle3(finalTranscript, localDate);
        if (extracted && !extracted.matched) {
          console.warn(
            '[cactus]',
            extracted.rawError || 'Needle 3 did not emit a save_note tool call.'
          );
        }
      } catch (err) {
        extracted = null;
        console.warn('[cactus] structured extraction failed:', err);
        if (!lastError) {
          lastError = 'Could not extract note details.';
        }
      }
    }
  }

  const merged = mergeCactusNoteFields(finalTranscript, durationSec, savedAudioUri, extracted);

  return {
    ...merged,
    audioState,
    sttEngine,
    lastError,
  };
}
