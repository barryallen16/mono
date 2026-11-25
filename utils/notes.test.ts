import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractStructuredNote } from './extract';
import {
  buildNoteFields,
  combineDraftAndTranscript,
  computeStreak,
  createMemoryNoteStore,
  filterNotes,
  formatDuration,
  formatLocalDate,
  KeyValueStorage,
  mergeCactusNoteFields,
  MonoNote,
} from './notes';

function createFakeStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('extractStructuredNote', () => {
  it('extracts title, tags, and action items from note text', () => {
    const result = extractStructuredNote(
      'Todo: fix login crash tomorrow. Need to verify SQLite migration.'
    );
    assert.equal(result.title, 'Todo: fix login crash tomorrow.');
    assert.ok(result.tags.includes('todo'));
    assert.ok(result.tags.includes('bug'));
    assert.deepEqual(
      result.actionItems.map((i) => i.text),
      ['fix login crash tomorrow.', 'verify SQLite migration.']
    );
  });

  it('defaults to log tag when no rule matches', () => {
    const result = extractStructuredNote('Quiet walk around the block');
    assert.deepEqual(result.tags, ['log']);
    assert.deepEqual(result.actionItems, []);
  });
});

describe('buildNoteFields', () => {
  it('builds a voice memo entry when audio has no transcript', () => {
    const fields = buildNoteFields('   ', 12, 'data:audio/webm;base64,AAA=');
    assert.equal(fields.title, 'Voice memo (00:12)');
    assert.equal(fields.transcript, '');
    assert.deepEqual(fields.tags, ['voice']);
    assert.deepEqual(fields.actionItems, []);
  });

  it('adds #voice ahead of extracted text tags when audio is attached', () => {
    const fields = buildNoteFields(
      'Todo: ship the bug fix today.',
      7,
      'file:///recordings/clip-1.m4a'
    );
    assert.equal(fields.tags[0], 'voice');
    assert.ok(fields.tags.includes('todo'));
    assert.ok(fields.tags.includes('bug'));
    assert.ok(fields.tags.includes('ship'));
    assert.ok(fields.tags.length <= 4);
  });
});

describe('computeStreak and formatters', () => {
  it('counts consecutive active days ending today or yesterday', () => {
    const today = new Date(2026, 10, 25, 12, 0, 0);
    const makeNote = (offsetDays: number, id: number): MonoNote => {
      const d = new Date(today);
      d.setDate(d.getDate() - offsetDays);
      return {
        id,
        title: `Note ${id}`,
        transcript: '',
        summary: '',
        tags: ['voice'],
        actionItems: [],
        durationSec: 3,
        audioUri: null,
        localDate: formatLocalDate(d),
        createdAt: d.toISOString(),
      };
    };

    assert.equal(computeStreak([], today), 0);
    assert.equal(
      computeStreak([makeNote(0, 1), makeNote(1, 2), makeNote(2, 3), makeNote(4, 4)], today),
      3
    );
    assert.equal(computeStreak([makeNote(1, 1), makeNote(2, 2)], today), 2);
    assert.equal(computeStreak([makeNote(2, 1)], today), 0);
  });

  it('formats durations cleanly', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(65), '01:05');
    assert.equal(formatDuration(-3), '00:00');
  });
});

describe('createMemoryNoteStore and filterNotes', () => {
  it('persists across store instances, toggles tasks, filters, and deletes', () => {
    const storage = createFakeStorage();
    const storeA = createMemoryNoteStore(storage);

    const voiceNote = storeA.create('', 8, 'data:audio/webm;base64,BBB=');
    const textNote = storeA.create('Todo: ship offline playback');

    const storeB = createMemoryNoteStore(storage);
    const reloaded = storeB.list();
    assert.equal(reloaded.length, 2);
    assert.equal(reloaded[0].id, textNote.id);
    assert.equal(reloaded[1].audioUri, 'data:audio/webm;base64,BBB=');

    assert.deepEqual(
      filterNotes(reloaded, 'voice').map((n) => n.id),
      [voiceNote.id]
    );
    assert.deepEqual(
      filterNotes(reloaded, 'ship offline').map((n) => n.id),
      [textNote.id]
    );

    const toggled = storeB.toggleAction(textNote.id, textNote.actionItems[0].id);
    assert.equal(toggled?.actionItems[0].done, true);

    storeB.remove(voiceNote.id);
    assert.deepEqual(
      createMemoryNoteStore(storage)
        .list()
        .map((n) => n.id),
      [textNote.id]
    );

    storeB.wipe();
    assert.deepEqual(createMemoryNoteStore(storage).list(), []);
  });

  it('rolls back in-memory list when storage throws quota error', () => {
    const fullStorage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createMemoryNoteStore(fullStorage);
    assert.throws(() => store.create('', 5, 'data:audio/webm;base64,CCC='), /QuotaExceededError/);
    assert.deepEqual(store.list(), []);
  });

  it('normalizes malformed stored entries and rolls back toggle/remove/wipe failures', () => {
    let failWrites = false;
    let rawValue = JSON.stringify([{ id: 7, title: 'Partial note' }, { id: 'bad' }]);
    const flakyStorage: KeyValueStorage = {
      getItem: () => rawValue,
      setItem: (_key, value) => {
        if (failWrites) throw new Error('QuotaExceededError');
        rawValue = value;
      },
    };

    const store = createMemoryNoteStore(flakyStorage);
    const items = store.list();
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].tags, []);
    assert.deepEqual(items[0].actionItems, []);

    const created = store.create('Todo: handle failure');
    failWrites = true;
    assert.throws(() => store.toggleAction(created.id, created.actionItems[0].id));
    assert.throws(() => store.remove(created.id));
    assert.throws(() => store.wipe());
    assert.equal(store.list().length, 2);
  });
});

describe('Cactus Whistle + Needle 3 field helpers', () => {
  it('combines typed draft text and Whistle transcript cleanly', () => {
    assert.equal(combineDraftAndTranscript('', 'Hello world'), 'Hello world');
    assert.equal(combineDraftAndTranscript('Note', ''), 'Note');
    assert.equal(
      combineDraftAndTranscript('Extra context', 'Heard speech'),
      'Heard speech\n\nExtra context'
    );
  });

  it('prefers Needle 3 structured extraction and prefixes #voice for audio notes', () => {
    const merged = mergeCactusNoteFields(
      'Fix the login crash before tomorrow and test SQLite',
      14,
      'file:///clip.m4a',
      {
        matched: true,
        title: 'Fix login crash',
        summary: 'Resolve login crash and test SQLite tomorrow.',
        tags: ['bug', 'todo'],
        actionItems: ['Fix the login crash', 'Test SQLite tomorrow'],
      }
    );
    assert.equal(merged.title, 'Fix login crash');
    assert.equal(merged.summary, 'Resolve login crash and test SQLite tomorrow.');
    assert.deepEqual(merged.tags, ['voice', 'bug', 'todo']);
    assert.deepEqual(
      merged.actionItems.map((item) => item.text),
      ['Fix the login crash', 'Test SQLite tomorrow']
    );
  });

  it('falls back to regex extraction when Needle 3 did not match', () => {
    const fallback = mergeCactusNoteFields('Todo: fix login crash tomorrow.', 0, null, {
      matched: false,
      title: '',
      summary: '',
      tags: [],
      actionItems: [],
    });
    assert.equal(fallback.title, 'Todo: fix login crash tomorrow.');
    assert.ok(fallback.tags.includes('todo'));
    assert.ok(fallback.tags.includes('bug'));
  });
});
