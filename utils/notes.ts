import { ActionItem, extractStructuredNote } from './extract';

export interface MonoNote {
  id: number;
  title: string;
  transcript: string;
  summary: string;
  tags: string[];
  actionItems: ActionItem[];
  durationSec: number;
  audioUri: string | null;
  localDate: string;
  createdAt: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const WEB_STORAGE_KEY = 'mono_notes_v1';

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

export interface CactusStructuredInput {
  matched: boolean;
  title: string;
  summary: string;
  tags: string[];
  actionItems: string[];
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
    return fallback;
  }

  const title = cactus.title.trim() || fallback.title;
  const summary = cactus.summary.trim() || fallback.summary;
  const rawTags = cactus.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
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

  return {
    title,
    transcript: trimmed,
    summary,
    tags,
    actionItems,
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
      const nextId = notes.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      const note: MonoNote = {
        id: Math.max(Date.now(), nextId),
        ...fields,
        durationSec,
        audioUri,
        localDate: formatLocalDate(now),
        createdAt: now.toISOString(),
      };
      commitNotes([note, ...notes]);
      return note;
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
