import { ActionItem, extractStructuredNote } from './extract';

export type AudioState = 'none' | 'pending' | 'done' | 'failed';
export type SttEngine = 'whistle' | 'none';
export type ExtractEngine = 'needle3' | 'regex' | 'none';
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

export type NoteUpdatePatch = Partial<
  Pick<
    MonoNote,
    | 'title'
    | 'transcript'
    | 'summary'
    | 'tags'
    | 'actionItems'
    | 'audioState'
    | 'sttEngine'
    | 'extractEngine'
    | 'extractConfidence'
    | 'lastError'
  >
>;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const WEB_STORAGE_KEY = 'mono_notes_v1';
const ALLOWED_TAG_SET = new Set<string>(ALLOWED_NOTE_TAGS);
const AUDIO_STATES = new Set<AudioState>(['none', 'pending', 'done', 'failed']);
const STT_ENGINES = new Set<SttEngine>(['whistle', 'none']);
const EXTRACT_ENGINES = new Set<ExtractEngine>(['needle3', 'regex', 'none']);

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

  const extracted = extractStructuredNote(trimmed);
  const tags = audioUri
    ? Array.from(new Set(['voice', ...extracted.tags])).slice(0, 4)
    : extracted.tags;

  return {
    title: extracted.title,
    transcript: trimmed,
    summary: extracted.summary,
    tags,
    actionItems: extracted.actionItems,
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
  if (!trimmed) {
    return {
      ...fallback,
      extractEngine: 'none' as ExtractEngine,
      extractConfidence: null as number | null,
    };
  }

  if (!cactus || !cactus.matched) {
    return {
      ...fallback,
      extractEngine: 'regex' as ExtractEngine,
      extractConfidence: null as number | null,
    };
  }

  const title = cactus.title.trim() || fallback.title;
  const summary = cactus.summary.trim() || fallback.summary;
  const rawTags = cactus.tags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => ALLOWED_TAG_SET.has(t));
  const baseTags = rawTags.length > 0 ? rawTags : fallback.tags;
  const tags = audioUri
    ? Array.from(new Set(['voice', ...baseTags])).slice(0, 4)
    : Array.from(new Set(baseTags)).slice(0, 4);

  const now = Date.now();
  const actionItems: ActionItem[] =
    cactus.actionItems.length > 0
      ? cactus.actionItems
          .map((text) => text.trim())
          .filter(Boolean)
          .slice(0, 5)
          .map((text, idx) => ({ id: `act-${now}-${idx}`, text, done: false }))
      : fallback.actionItems;

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
    return terms.every((term) => haystack.includes(term));
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

function normalizeNote(raw: Partial<MonoNote> & { id: number }): MonoNote {
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled note',
    transcript: typeof raw.transcript === 'string' ? raw.transcript : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    actionItems: Array.isArray(raw.actionItems) ? raw.actionItems : [],
    durationSec: typeof raw.durationSec === 'number' ? raw.durationSec : 0,
    audioUri: typeof raw.audioUri === 'string' ? raw.audioUri : null,
    audioState: parseAudioState(raw.audioState),
    sttEngine: parseSttEngine(raw.sttEngine),
    extractEngine: parseExtractEngine(raw.extractEngine),
    extractConfidence:
      typeof raw.extractConfidence === 'number' && Number.isFinite(raw.extractConfidence)
        ? raw.extractConfidence
        : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    localDate: typeof raw.localDate === 'string' ? raw.localDate : formatLocalDate(),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

export function createMemoryNoteStore(storage?: KeyValueStorage | null) {
  let hydrated = false;
  let notes: MonoNote[] = [];

  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    if (!storage) return;
    try {
      const raw = storage.getItem(WEB_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          notes = parsed
            .filter((item): item is Partial<MonoNote> & { id: number } =>
              Boolean(item && typeof item === 'object' && typeof item.id === 'number')
            )
            .map(normalizeNote);
        }
      }
    } catch {
      notes = [];
    }
  };

  const commitNotes = (next: MonoNote[]) => {
    const prev = notes;
    notes = next;
    if (!storage) return;
    try {
      storage.setItem(WEB_STORAGE_KEY, JSON.stringify(notes));
    } catch (err) {
      notes = prev;
      throw err;
    }
  };

  const nextNoteId = () => {
    const nextId = notes.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    return Math.max(Date.now(), nextId);
  };

  return {
    list(): MonoNote[] {
      hydrate();
      return notes.map((n) => ({ ...n, actionItems: [...n.actionItems], tags: [...n.tags] }));
    },
    create(
      transcript: string,
      durationSec = 0,
      audioUri: string | null = null,
      now = new Date()
    ): MonoNote {
      hydrate();
      const fields = buildNoteFields(transcript, durationSec, audioUri);
      const note: MonoNote = {
        id: nextNoteId(),
        ...fields,
        durationSec,
        audioUri,
        audioState: 'none',
        sttEngine: 'none',
        extractEngine: fields.transcript ? 'regex' : 'none',
        extractConfidence: null,
        lastError: null,
        localDate: formatLocalDate(now),
        createdAt: now.toISOString(),
      };
      commitNotes([note, ...notes]);
      return note;
    },
    createPending(
      transcript: string,
      durationSec = 0,
      audioUri: string | null = null,
      now = new Date()
    ): MonoNote {
      hydrate();
      const trimmed = transcript.trim();
      const fields = audioUri
        ? {
            title: 'Voice note (pending)',
            transcript: trimmed,
            summary: '',
            tags: ['voice'],
            actionItems: [] as ActionItem[],
          }
        : buildNoteFields(trimmed, durationSec, null);
      const note: MonoNote = {
        id: nextNoteId(),
        ...fields,
        durationSec,
        audioUri,
        audioState: audioUri ? 'pending' : 'none',
        sttEngine: 'none',
        extractEngine: audioUri || !trimmed ? 'none' : 'regex',
        extractConfidence: null,
        lastError: null,
        localDate: formatLocalDate(now),
        createdAt: now.toISOString(),
      };
      commitNotes([note, ...notes]);
      return note;
    },
    update(noteId: number, patch: NoteUpdatePatch): MonoNote | null {
      hydrate();
      const idx = notes.findIndex((n) => n.id === noteId);
      if (idx === -1) return null;
      const current = notes[idx];
      const updated: MonoNote = {
        ...current,
        title: patch.title !== undefined ? patch.title : current.title,
        transcript: patch.transcript !== undefined ? patch.transcript : current.transcript,
        summary: patch.summary !== undefined ? patch.summary : current.summary,
        tags: patch.tags !== undefined ? [...patch.tags] : current.tags,
        actionItems: patch.actionItems !== undefined ? [...patch.actionItems] : current.actionItems,
        audioState: patch.audioState !== undefined ? patch.audioState : current.audioState,
        sttEngine: patch.sttEngine !== undefined ? patch.sttEngine : current.sttEngine,
        extractEngine:
          patch.extractEngine !== undefined ? patch.extractEngine : current.extractEngine,
        extractConfidence:
          patch.extractConfidence !== undefined
            ? patch.extractConfidence
            : current.extractConfidence,
        lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
      };
      commitNotes([...notes.slice(0, idx), updated, ...notes.slice(idx + 1)]);
      return updated;
    },
    toggleAction(noteId: number, actionId: string): MonoNote | null {
      hydrate();
      const idx = notes.findIndex((n) => n.id === noteId);
      if (idx === -1) return null;
      const updated: MonoNote = {
        ...notes[idx],
        actionItems: toggleActionInList(notes[idx].actionItems, actionId),
      };
      commitNotes([...notes.slice(0, idx), updated, ...notes.slice(idx + 1)]);
      return updated;
    },
    remove(noteId: number): MonoNote | null {
      hydrate();
      const target = notes.find((n) => n.id === noteId) ?? null;
      if (!target) return null;
      commitNotes(notes.filter((n) => n.id !== noteId));
      return target;
    },
    wipe(): void {
      hydrate();
      commitNotes([]);
    },
  };
}
