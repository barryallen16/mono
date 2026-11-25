import * as SQLite from 'expo-sqlite';

export type NotesDatabase = SQLite.SQLiteDatabase;

let dbPromise: Promise<NotesDatabase | null> | null = null;

const MIGRATION_COLUMNS: [string, string][] = [
  ['audio_uri', 'TEXT'],
  ['audio_state', "TEXT NOT NULL DEFAULT 'none'"],
  ['stt_engine', "TEXT NOT NULL DEFAULT 'none'"],
  ['extract_engine', "TEXT NOT NULL DEFAULT 'none'"],
  ['extract_confidence', 'REAL'],
  ['last_error', 'TEXT'],
];

export function getSQLiteDatabase(): Promise<NotesDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('mono.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          transcript TEXT NOT NULL,
          summary TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          action_items_json TEXT NOT NULL,
          duration_sec INTEGER NOT NULL DEFAULT 0,
          audio_uri TEXT,
          audio_state TEXT NOT NULL DEFAULT 'none',
          stt_engine TEXT NOT NULL DEFAULT 'none',
          extract_engine TEXT NOT NULL DEFAULT 'none',
          extract_confidence REAL,
          last_error TEXT,
          local_date TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(notes)');
      const existing = new Set(columns.map((col) => col.name));
      for (const [name, definition] of MIGRATION_COLUMNS) {
        if (!existing.has(name)) {
          await db.execAsync(`ALTER TABLE notes ADD COLUMN ${name} ${definition};`);
        }
      }
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
