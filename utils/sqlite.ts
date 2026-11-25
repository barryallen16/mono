import * as SQLite from 'expo-sqlite';

export type NotesDatabase = SQLite.SQLiteDatabase;

let dbPromise: Promise<NotesDatabase | null> | null = null;

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
          local_date TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(notes)');
      if (!columns.some((col) => col.name === 'audio_uri')) {
        await db.execAsync('ALTER TABLE notes ADD COLUMN audio_uri TEXT;');
      }
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
