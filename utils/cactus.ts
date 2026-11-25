import { combineDraftAndTranscript, formatLocalDate, mergeCactusNoteFields } from './notes';

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
  if (savedAudioUri && isCactusAvailable()) {
    try {
      const stt = await transcribeWithWhistle(savedAudioUri, null);
      heardText = stt?.text ?? '';
    } catch {
      heardText = '';
    }
  }

  const finalTranscript = combineDraftAndTranscript(draftText, heardText);
  let extracted = null;

  if (finalTranscript && isCactusAvailable()) {
    try {
      extracted = await extractWithNeedle3(finalTranscript, localDate);
    } catch {
      extracted = null;
    }
  }

  return mergeCactusNoteFields(finalTranscript, durationSec, savedAudioUri, extracted);
}
