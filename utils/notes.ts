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

const AUDIO_STATES = new Set<AudioState>(['none', 'pending', 'done', 'failed']);
const STT_ENGINES = new Set<SttEngine>(['whistle', 'none']);
const EXTRACT_ENGINES = new Set<ExtractEngine>(['needle3', 'none']);
const ALLOWED_TAG_SET = new Set<string>(ALLOWED_NOTE_TAGS);

function normalizeTaskCompareKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanActionItems(rawItems: string[]): ActionItem[] {
  const now = Date.now();
  const deduped: string[] = [];
  const dedupedKeys: string[] = [];

  for (const raw of rawItems) {
    const clean = raw
      .trim()
      .replace(/^[-*•\d.)]+\s*/, '')
      .replace(/[.;,]+$/, '')
      .trim();
    if (clean.length < 3 || clean.endsWith('?')) continue;

    const normalized = clean.charAt(0).toUpperCase() + clean.slice(1);
    const key = normalizeTaskCompareKey(normalized);
    if (!key) continue;

    const isDuplicate = dedupedKeys.some(
      (existing) => existing === key || existing.includes(key) || key.includes(existing)
    );
    if (!isDuplicate) {
      deduped.push(normalized);
      dedupedKeys.push(key);
    }
    if (deduped.length >= 6) break;
  }

  return deduped.map((text, idx) => ({ id: `act-${now}-${idx}`, text, done: false }));
}

function finalizeTags(
  rawTags: string[],
  actionItems: Pick<ActionItem, 'text'>[],
  audioUri: string | null = null
): string[] {
  const found = new Set<string>();
  for (const raw of rawTags) {
    const tag = raw.trim().toLowerCase();
    if (tag !== 'todo' && ALLOWED_TAG_SET.has(tag)) {
      found.add(tag);
    }
  }
  if (actionItems.length > 0) {
    found.add('todo');
  }
  const ordered = ALLOWED_NOTE_TAGS.filter((tag) => found.has(tag));
  if (audioUri) {
    return Array.from(new Set(['voice', ...ordered])).slice(0, 4);
  }
  return ordered.length > 0 ? ordered.slice(0, 4) : ['log'];
}

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
  const actionItems = cleanActionItems(cactus.actionItems);
  const tags = finalizeTags(cactus.tags, actionItems, audioUri);

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
