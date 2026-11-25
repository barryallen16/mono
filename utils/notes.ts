export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
}

export type AudioState = 'none' | 'pending' | 'done' | 'failed';
export type SttEngine = 'whistle' | 'none';
export type ExtractEngine = 'needle3' | 'none';
export const ALLOWED_NOTE_TAGS = ['bug', 'ship', 'idea', 'people', 'todo', 'study', 'log'] as const;

export interface MonoNote {
  id: number;
  title: string;
  transcript: string;
  summary: string;
  tags: string[];
  actionItems: ActionItem[];
  durationSec: number;
  audioUri: string | null;
  audioState: AudioState;
  sttEngine: SttEngine;
  extractEngine: ExtractEngine;
  extractConfidence: number | null;
  lastError: string | null;
  localDate: string;
  createdAt: string;
}

const ALLOWED_TAG_SET = new Set<string>(ALLOWED_NOTE_TAGS);
const AUDIO_STATES = new Set<AudioState>(['none', 'pending', 'done', 'failed']);
const STT_ENGINES = new Set<SttEngine>(['whistle', 'none']);
const EXTRACT_ENGINES = new Set<ExtractEngine>(['needle3', 'none']);

export function parseAudioState(value: unknown): AudioState {
  return typeof value === 'string' && AUDIO_STATES.has(value as AudioState)
    ? (value as AudioState)
    : 'none';
}

export function parseSttEngine(value: unknown): SttEngine {
  return typeof value === 'string' && STT_ENGINES.has(value as SttEngine)
    ? (value as SttEngine)
    : 'none';
}

export function parseExtractEngine(value: unknown): ExtractEngine {
  return typeof value === 'string' && EXTRACT_ENGINES.has(value as ExtractEngine)
    ? (value as ExtractEngine)
    : 'none';
}

export function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = String(Math.floor(safe / 60)).padStart(2, '0');
  const secs = String(safe % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function defaultTitleFromText(text: string): string {
  const firstLine = text.split(/\n+/)[0]?.trim() || text;
  const words = firstLine.split(/\s+/).filter(Boolean);
  return words.length > 7 ? `${words.slice(0, 7).join(' ')}...` : firstLine || 'Untitled note';
}

export function buildNoteFields(
  transcript: string,
  durationSec = 0,
  audioUri: string | null = null
) {
  const trimmed = transcript.trim();
  if (!trimmed && audioUri) {
    const suffix = durationSec > 0 ? ` (${formatDuration(durationSec)})` : '';
    return {
      title: `Voice memo${suffix}`,
      transcript: '',
      summary: '',
      tags: ['voice'],
      actionItems: [] as ActionItem[],
    };
  }

  return {
    title: defaultTitleFromText(trimmed),
    transcript: trimmed,
    summary: '',
    tags: audioUri ? ['voice'] : ['log'],
    actionItems: [] as ActionItem[],
  };
}

export function combineDraftAndTranscript(draftText: string, heardText: string): string {
  const draft = draftText.trim();
  const heard = heardText.trim();
  if (draft && heard) return `${heard}\n\n${draft}`;
  return heard || draft;
}

function normalizeBoundaryWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
}

export function mergeChunkTranscripts(chunks: string[]): string {
  const nonEmpty = chunks.map((chunk) => chunk.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return '';
  if (nonEmpty.length === 1) return nonEmpty[0];

  const words = nonEmpty[0].split(/\s+/).filter(Boolean);
  for (let i = 1; i < nonEmpty.length; i += 1) {
    const nextWords = nonEmpty[i].split(/\s+/).filter(Boolean);
    const maxOverlap = Math.min(6, words.length, nextWords.length);
    let overlap = 0;

    for (let k = maxOverlap; k >= 1; k -= 1) {
      let matched = true;
      for (let j = 0; j < k; j += 1) {
        const left = normalizeBoundaryWord(words[words.length - k + j]);
        const right = normalizeBoundaryWord(nextWords[j]);
        if (!left || left !== right) {
          matched = false;
          break;
        }
      }
      if (matched) {
        overlap = k;
        break;
      }
    }

    if (
      overlap > 0 &&
      /[.!?,;:]$/.test(nextWords[overlap - 1]) &&
      !/[.!?,;:]$/.test(words[words.length - 1])
    ) {
      words[words.length - 1] = nextWords[overlap - 1];
    }

    words.push(...nextWords.slice(overlap));
  }

  return words.join(' ');
}

export interface CactusStructuredInput {
  matched: boolean;
  title: string;
  summary: string;
  tags: string[];
  actionItems: string[];
  confidence?: number | null;
}

export function mergeCactusNoteFields(
  transcript: string,
  durationSec = 0,
  audioUri: string | null = null,
  cactus: CactusStructuredInput | null = null
) {
  const fallback = buildNoteFields(transcript, durationSec, audioUri);
  const trimmed = transcript.trim();
  if (!trimmed || !cactus || !cactus.matched) {
    return {
      ...fallback,
      extractEngine: 'none' as ExtractEngine,
      extractConfidence: null as number | null,
    };
  }

  const title = cactus.title.trim() || fallback.title;
  const summary = cactus.summary.trim();
  const rawTags = cactus.tags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => ALLOWED_TAG_SET.has(t));
  const baseTags = rawTags.length > 0 ? rawTags : ['log'];
  const tags = audioUri
    ? Array.from(new Set(['voice', ...baseTags])).slice(0, 4)
    : Array.from(new Set(baseTags)).slice(0, 4);

  const now = Date.now();
  const actionItems: ActionItem[] = cactus.actionItems
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((text, idx) => ({ id: `act-${now}-${idx}`, text, done: false }));

  const extractConfidence =
    typeof cactus.confidence === 'number' && Number.isFinite(cactus.confidence)
      ? cactus.confidence
      : null;

  return {
    title,
    transcript: trimmed,
    summary,
    tags,
    actionItems,
    extractEngine: 'needle3' as ExtractEngine,
    extractConfidence,
  };
}

export function filterNotes(notes: MonoNote[], query: string): MonoNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  const terms = q.split(/\s+/).filter(Boolean);
  return notes.filter((note) => {
    const actionsText = note.actionItems.map((item) => item.text).join(' ');
    const haystack =
      `${note.title} ${note.summary} ${note.transcript} ${note.tags.join(' ')} ${actionsText}`.toLowerCase();
    return terms.every((term) => {
      if (term.startsWith('#') && term.length > 1) {
        const tagTerm = term.slice(1);
        return haystack.includes(term) || note.tags.some((t) => t.toLowerCase().includes(tagTerm));
      }
      return haystack.includes(term);
    });
  });
}

export function toggleActionInList(items: ActionItem[], actionId: string): ActionItem[] {
  return items.map((item) => (item.id === actionId ? { ...item, done: !item.done } : item));
}

export function computeStreak(notes: MonoNote[], now = new Date()): number {
  const dates = new Set(notes.map((n) => n.localDate));
  const cursor = new Date(now);
  let key = formatLocalDate(cursor);
  if (!dates.has(key)) {
    cursor.setDate(cursor.getDate() - 1);
    key = formatLocalDate(cursor);
    if (!dates.has(key)) return 0;
  }
  let streak = 0;
  while (dates.has(key)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    key = formatLocalDate(cursor);
  }
  return streak;
}
