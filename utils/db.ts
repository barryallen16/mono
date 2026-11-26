import { deleteAllSavedAudioFiles, discardTempAudioClip, persistAudioClip } from './audio';
import { getWhistleKeywords, processNoteWithCactus } from './cactus';
import {
  buildNoteFields,
  computeStreak,
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
  const rows = await db.getAllAsync<NoteRow>('SELECT * FROM notes ORDER BY id DESC');
  return rows.map(rowToNote);
}

const inFlightProcessing = new Map<number, Promise<MonoNote | null>>();

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function mergeDoneFlags(
  nextItems: MonoNote['actionItems'],
  existingItems: MonoNote['actionItems']
): MonoNote['actionItems'] {
  if (existingItems.length === 0) return nextItems;
  const doneTexts = new Set(
    existingItems.filter((item) => item.done).map((item) => item.text.trim().toLowerCase())
  );
  if (doneTexts.size === 0) return nextItems;
  return nextItems.map((item) =>
    doneTexts.has(item.text.trim().toLowerCase()) ? { ...item, done: true } : item
  );
}

export async function createQuickNote(
  draftText: string,
  durationSec = 0,
  tempAudioUri: string | null = null
): Promise<MonoNote> {
  const savedAudioUri = await persistAudioClip(tempAudioUri);
  const db = await getSQLiteDatabase();

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
      'none',
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

export function processSavedNote(noteId: number, draftText = ''): Promise<MonoNote | null> {
  const existingRun = inFlightProcessing.get(noteId);
  if (existingRun) return existingRun;

  const run = (async (): Promise<MonoNote | null> => {
    const db = await getSQLiteDatabase();
    const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
    if (!row) return null;
    const note = rowToNote(row);
    const hasExistingTranscript = note.audioState === 'done' && Boolean(note.transcript.trim());
    const effectiveDraft = draftText.trim()
      ? draftText
      : note.sttEngine === 'none'
        ? note.transcript
        : '';

    const keywords = hasExistingTranscript ? '' : await getWhistleKeywords();
    const fields = await processNoteWithCactus(
      effectiveDraft,
      note.durationSec,
      note.audioUri,
      note.localDate,
      hasExistingTranscript
        ? { skipStt: true, existingTranscript: note.transcript }
        : { keywords: keywords || null }
    );

    const latestRow = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
    if (!latestRow) return null;
    const latest = rowToNote(latestRow);
    const userEdited =
      latest.title !== note.title ||
      latest.transcript !== note.transcript ||
      JSON.stringify(latest.tags) !== JSON.stringify(note.tags) ||
      JSON.stringify(latest.actionItems) !== JSON.stringify(note.actionItems);

    const nextTitle = userEdited ? latest.title : fields.title;
    const nextTranscript = userEdited ? latest.transcript : fields.transcript;
    const nextSummary = userEdited ? latest.summary : fields.summary;
    const nextTags = userEdited ? latest.tags : fields.tags;
    const nextActions = userEdited
      ? latest.actionItems
      : mergeDoneFlags(fields.actionItems, latest.actionItems);

    await db.runAsync(
      `UPDATE notes
       SET title = ?, transcript = ?, summary = ?, tags_json = ?, action_items_json = ?,
           audio_state = ?, stt_engine = ?, extract_engine = ?, extract_confidence = ?, last_error = ?
       WHERE id = ?`,
      nextTitle,
      nextTranscript,
      nextSummary,
      JSON.stringify(nextTags),
      JSON.stringify(nextActions),
      fields.audioState,
      fields.sttEngine,
      fields.extractEngine,
      fields.extractConfidence,
      fields.lastError,
      noteId
    );

    const updated = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', noteId);
    return updated ? rowToNote(updated) : null;
  })().finally(() => {
    inFlightProcessing.delete(noteId);
  });

  inFlightProcessing.set(noteId, run);
  return run;
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
  const row = await db.getFirstAsync<Pick<NoteRow, 'audio_uri'>>(
    'SELECT audio_uri FROM notes WHERE id = ?',
    noteId
  );
  await db.runAsync('DELETE FROM notes WHERE id = ?', noteId);
  await discardTempAudioClip(row?.audio_uri ?? null);
}

export async function wipeAllNotes(): Promise<void> {
  const db = await getSQLiteDatabase();
  await db.runAsync('DELETE FROM notes');
  await deleteAllSavedAudioFiles();
}

export async function searchNotes(query: string, tag = 'all'): Promise<MonoNote[]> {
  const db = await getSQLiteDatabase();
  const conditions: string[] = [];
  const params: string[] = [];
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  for (const term of terms) {
    const rawTerm = term.startsWith('#') && term.length > 1 ? term.slice(1) : term;
    const escaped = escapeSqlLike(rawTerm);
    conditions.push(
      "LOWER(title || ' ' || summary || ' ' || transcript || ' ' || tags_json || ' ' || action_items_json) LIKE ? ESCAPE '\\'"
    );
    params.push(`%${escaped}%`);
  }

  if (tag !== 'all') {
    conditions.push("tags_json LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeSqlLike(tag)}"%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.getAllAsync<NoteRow>(
    `SELECT * FROM notes ${whereClause} ORDER BY id DESC`,
    ...params
  );
  const candidates = rows.map(rowToNote);
  const exact = filterNotes(candidates, query);
  return tag === 'all' ? exact : exact.filter((note) => note.tags.includes(tag));
}
