import { deleteAllSavedAudioFiles, discardTempAudioClip, persistAudioClip } from './audio';
import {
  buildNoteFields,
  computeStreak,
  createMemoryNoteStore,
  filterNotes,
  formatLocalDate,
  MonoNote,
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

function rowToNote(row: NoteRow): MonoNote {
  return {
    id: row.id,
    title: row.title,
    transcript: row.transcript,
    summary: row.summary,
    tags: JSON.parse(row.tags_json || '[]'),
    actionItems: JSON.parse(row.action_items_json || '[]'),
    durationSec: row.duration_sec,
    audioUri: row.audio_uri ?? null,
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

  const fields = buildNoteFields(transcript, durationSec, savedAudioUri);
  const localDate = formatLocalDate();
  const createdAt = new Date().toISOString();

  try {
    const result = await db.runAsync(
      `INSERT INTO notes (title, transcript, summary, tags_json, action_items_json, duration_sec, audio_uri, local_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.title,
      fields.transcript,
      fields.summary,
      JSON.stringify(fields.tags),
      JSON.stringify(fields.actionItems),
      durationSec,
      savedAudioUri,
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

export async function searchNotes(query: string): Promise<MonoNote[]> {
  const notes = await listNotes();
  return filterNotes(notes, query);
}
