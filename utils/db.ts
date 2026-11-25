import { deleteAllSavedAudioFiles, discardTempAudioClip, persistAudioClip } from './audio';
import { processNoteWithCactus } from './cactus';
import {
  buildNoteFields,
  computeStreak,
  createMemoryNoteStore,
  filterNotes,
  formatLocalDate,
  MonoNote,
  parseAudioState,
  parseExtractEngine,
  parseSttEngine,
  toggleActionInList,
} from './notes';
import { getSQLiteDatabase } from './sqlite';

export { computeStreak, formatLocalDate };
export type { MonoNote };

interface NoteRow {
  id: number;
  title: string;
  transcript: string;
  summary: string;
  tags_json: string;
  action_items_json: string;
  duration_sec: number;
  audio_uri: string | null;
  audio_state?: string | null;
  stt_engine?: string | null;
  extract_engine?: string | null;
  extract_confidence?: number | null;
  last_error?: string | null;
  local_date: string;
  created_at: string;
}

const webStore = createMemoryNoteStore({
  getItem: (key) => (typeof window !== 'undefined' ? window.localStorage.getItem(key) : null),
  setItem: (key, value) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  },
});

export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function rowToNote(row: NoteRow): MonoNote {
  return {
    id: row.id,
    title: row.title,
    transcript: row.transcript,
    summary: row.summary,
    tags: parseJsonArray<string>(row.tags_json),
    actionItems: parseJsonArray<MonoNote['actionItems'][number]>(row.action_items_json),
    durationSec: row.duration_sec,
    audioUri: row.audio_uri ?? null,
    audioState: parseAudioState(row.audio_state),
    sttEngine: parseSttEngine(row.stt_engine),
    extractEngine: parseExtractEngine(row.extract_engine),
    extractConfidence:
      typeof row.extract_confidence === 'number' && Number.isFinite(row.extract_confidence)
        ? row.extract_confidence
        : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    localDate: row.local_date,
    createdAt: row.created_at,
  };
}

export async function listNotes(): Promise<MonoNote[]> {
  const db = await getSQLiteDatabase();
  if (!db) return webStore.list();
  const rows = await db.getAllAsync<NoteRow>('SELECT * FROM notes ORDER BY id DESC');
  return rows.map(rowToNote);
}

export async function createNote(
  transcript: string,
  durationSec = 0,
  tempAudioUri: string | null = null
): Promise<MonoNote> {
  const savedAudioUri = await persistAudioClip(tempAudioUri);
  const db = await getSQLiteDatabase();

  if (!db) {
    try {
      return webStore.create(transcript, durationSec, savedAudioUri);
    } catch (err) {
      if (savedAudioUri && savedAudioUri !== tempAudioUri) {
        await discardTempAudioClip(savedAudioUri);
      }
      throw err;
    }
  }

  const localDate = formatLocalDate();
  const createdAt = new Date().toISOString();

  try {
    const fields = await processNoteWithCactus(transcript, durationSec, savedAudioUri, localDate);
    const result = await db.runAsync(
      `INSERT INTO notes (
        title, transcript, summary, tags_json, action_items_json,
        duration_sec, audio_uri, audio_state, stt_engine, extract_engine,
        extract_confidence, last_error, local_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.title,
      fields.transcript,
      fields.summary,
      JSON.stringify(fields.tags),
      JSON.stringify(fields.actionItems),
      durationSec,
      savedAudioUri,
      fields.audioState,
      fields.sttEngine,
      fields.extractEngine,
      fields.extractConfidence,
      fields.lastError,
      localDate,
      createdAt
    );

    const row = await db.getFirstAsync<NoteRow>(
      'SELECT * FROM notes WHERE id = ?',
      result.lastInsertRowId
    );
    if (!row) {
      throw new Error('Failed to read saved note');
    }
    return rowToNote(row);
  } catch (err) {
    if (savedAudioUri && savedAudioUri !== tempAudioUri) {
      await discardTempAudioClip(savedAudioUri);
    }
    throw err;
  }
}

export async function createQuickNote(
  draftText: string,
  durationSec = 0,
  tempAudioUri: string | null = null
): Promise<MonoNote> {
  const savedAudioUri = await persistAudioClip(tempAudioUri);
  const db = await getSQLiteDatabase();

  if (!db) {
    try {
      return webStore.createPending(draftText, durationSec, savedAudioUri);
    } catch (err) {
      if (savedAudioUri && savedAudioUri !== tempAudioUri) {
        await discardTempAudioClip(savedAudioUri);
      }
      throw err;
    }
  }

  const localDate = formatLocalDate();
  const createdAt = new Date().toISOString();
  const trimmed = draftText.trim();
  const fields = savedAudioUri
    ? {
        title: 'Voice note (pending)',
        transcript: trimmed,
        summary: '',
        tags: ['voice'],
        actionItems: [] as MonoNote['actionItems'],
      }
    : buildNoteFields(trimmed, durationSec, null);
  const audioState = savedAudioUri ? 'pending' : 'none';
  const extractEngine = savedAudioUri || !trimmed ? 'none' : 'regex';

  try {
    const result = await db.runAsync(
      `INSERT INTO notes (
        title, transcript, summary, tags_json, action_items_json,
        duration_sec, audio_uri, audio_state, stt_engine, extract_engine,
        extract_confidence, last_error, local_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.title,
      fields.transcript,
      fields.summary,
      JSON.stringify(fields.tags),
      JSON.stringify(fields.actionItems),
      durationSec,
      savedAudioUri,
      audioState,
      'none',
      extractEngine,
      null,
      null,
      localDate,
      createdAt
    );

    const row = await db.getFirstAsync<NoteRow>(
      'SELECT * FROM notes WHERE id = ?',
      result.lastInsertRowId
    );
    if (!row) {
      throw new Error('Failed to read saved note');
    }
    return rowToNote(row);
  } catch (err) {
    if (savedAudioUri && savedAudioUri !== tempAudioUri) {
      await discardTempAudioClip(savedAudioUri);
    }
    throw err;
  }
}

export async function processSavedNote(noteId: number, draftText = ''): Promise<MonoNote | null> {
  const db = await getSQLiteDatabase();

  if (!db) {
    const target = webStore.list().find((n) => n.id === noteId);
    if (!target) return null;
    const effectiveDraft = draftText.trim()
      ? draftText
      : target.sttEngine === 'none'
        ? target.transcript
        : '';
    const fields = await processNoteWithCactus(
      effectiveDraft,
      target.durationSec,
      target.audioUri,
      target.localDate
    );
    return webStore.update(noteId, fields);
  }

  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
  if (!row) return null;
  const note = rowToNote(row);
  const effectiveDraft = draftText.trim()
    ? draftText
    : note.sttEngine === 'none'
      ? note.transcript
      : '';

  const fields = await processNoteWithCactus(
    effectiveDraft,
    note.durationSec,
    note.audioUri,
    note.localDate
  );

  await db.runAsync(
    `UPDATE notes
     SET title = ?, transcript = ?, summary = ?, tags_json = ?, action_items_json = ?,
         audio_state = ?, stt_engine = ?, extract_engine = ?, extract_confidence = ?, last_error = ?
     WHERE id = ?`,
    fields.title,
    fields.transcript,
    fields.summary,
    JSON.stringify(fields.tags),
    JSON.stringify(fields.actionItems),
    fields.audioState,
    fields.sttEngine,
    fields.extractEngine,
    fields.extractConfidence,
    fields.lastError,
    noteId
  );

  const updated = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
  return updated ? rowToNote(updated) : null;
}

export async function updateNote(
  noteId: number,
  patch: {
    title?: string;
    transcript?: string;
    summary?: string;
    tags?: string[];
    actionItems?: MonoNote['actionItems'];
  }
): Promise<MonoNote | null> {
  const db = await getSQLiteDatabase();
  if (!db) return webStore.update(noteId, patch);

  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
  if (!row) return null;
  const current = rowToNote(row);
  const next: MonoNote = {
    ...current,
    title: patch.title !== undefined ? patch.title : current.title,
    transcript: patch.transcript !== undefined ? patch.transcript : current.transcript,
    summary: patch.summary !== undefined ? patch.summary : current.summary,
    tags: patch.tags !== undefined ? [...patch.tags] : current.tags,
    actionItems: patch.actionItems !== undefined ? [...patch.actionItems] : current.actionItems,
  };

  await db.runAsync(
    'UPDATE notes SET title = ?, transcript = ?, summary = ?, tags_json = ?, action_items_json = ? WHERE id = ?',
    next.title,
    next.transcript,
    next.summary,
    JSON.stringify(next.tags),
    JSON.stringify(next.actionItems),
    noteId
  );

  return next;
}

export async function toggleActionItem(noteId: number, actionId: string): Promise<MonoNote | null> {
  const db = await getSQLiteDatabase();
  if (!db) return webStore.toggleAction(noteId, actionId);

  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
  if (!row) return null;
  const target = rowToNote(row);
  const updatedItems = toggleActionInList(target.actionItems, actionId);

  await db.runAsync(
    'UPDATE notes SET action_items_json = ? WHERE id = ?',
    JSON.stringify(updatedItems),
    noteId
  );
  return { ...target, actionItems: updatedItems };
}

export async function deleteNote(noteId: number): Promise<void> {
  const db = await getSQLiteDatabase();
  if (!db) {
    webStore.remove(noteId);
    return;
  }
  const row = await db.getFirstAsync<Pick<NoteRow, 'audio_uri'>>(
    'SELECT audio_uri FROM notes WHERE id = ?',
    noteId
  );
  await db.runAsync('DELETE FROM notes WHERE id = ?', noteId);
  await discardTempAudioClip(row?.audio_uri ?? null);
}

export async function wipeAllNotes(): Promise<void> {
  const db = await getSQLiteDatabase();
  if (!db) {
    webStore.wipe();
    return;
  }
  await db.runAsync('DELETE FROM notes');
  await deleteAllSavedAudioFiles();
}

export async function searchNotes(query: string, tag = 'all'): Promise<MonoNote[]> {
  const db = await getSQLiteDatabase();
  if (!db) {
    const filtered = filterNotes(webStore.list(), query);
    return tag === 'all' ? filtered : filtered.filter((note) => note.tags.includes(tag));
  }

  const conditions: string[] = [];
  const params: string[] = [];
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  for (const term of terms) {
    conditions.push(
      "LOWER(title || ' ' || summary || ' ' || transcript || ' ' || tags_json || ' ' || action_items_json) LIKE ?"
    );
    params.push(`%${term}%`);
  }

  if (tag !== 'all') {
    conditions.push('tags_json LIKE ?');
    params.push(`%"${tag}"%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.getAllAsync<NoteRow>(
    `SELECT * FROM notes ${whereClause} ORDER BY id DESC`,
    ...params
  );
  return rows.map(rowToNote);
}
