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
  isCactusAvailable,
  prepareCactusModels,
  subscribeCactusProgress,
  transcribeWithWhistle,
} from '~/modules/cactus-native/src';

export type { CactusProgressEvent, CactusStatus };
export {
  clearCactusModels,
  getCactusStatus,
  isCactusAvailable,
  prepareCactusModels,
  subscribeCactusProgress,
};

export async function processNoteWithCactus(
  draftText: string,
  durationSec: number,
  savedAudioUri: string | null,
  localDate = formatLocalDate()
) {
  let heardText = '';
  let audioState: AudioState = 'none';
  let sttEngine: SttEngine = 'none';
  let lastError: string | null = null;

  const cactusAvailable = isCactusAvailable();
  let status: CactusStatus | null = null;
  if (cactusAvailable && (savedAudioUri || draftText.trim())) {
    try {
      status = await getCactusStatus();
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Failed to inspect Cactus runtime.';
    }
  }

  if (savedAudioUri && cactusAvailable) {
    if (!status?.supported) {
      audioState = 'failed';
      sttEngine = 'none';
      if (!lastError) {
        lastError = 'On-device speech requires ARM Android.';
      }
    } else if (!status.whistleCached && !status.whistleLoaded) {
      audioState = 'pending';
      sttEngine = 'none';
      lastError = 'Speech model not downloaded yet. Tap Retry once cached.';
    } else {
      try {
        const stt = await transcribeWithWhistle(savedAudioUri, 'en');
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

  const finalTranscript = combineDraftAndTranscript(draftText, heardText);
  let extracted = null;

  if (
    finalTranscript &&
    cactusAvailable &&
    status?.supported &&
    (status.needleCached || status.needleLoaded)
  ) {
    try {
      extracted = await extractWithNeedle3(finalTranscript, localDate);
    } catch (err) {
      extracted = null;
      if (!lastError) {
        lastError = err instanceof Error ? err.message : 'Structured extraction failed.';
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
