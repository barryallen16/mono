import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractStructuredNote } from './extract';
import {
  ALLOWED_NOTE_TAGS,
  buildNoteFields,
  combineDraftAndTranscript,
  computeStreak,
  createMemoryNoteStore,
  filterNotes,
  formatDuration,
  formatLocalDate,
  KeyValueStorage,
  mergeCactusNoteFields,
  mergeChunkTranscripts,
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
        audioState: 'none',
        sttEngine: 'none',
        extractEngine: 'none',
        extractConfidence: null,
        lastError: null,
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
    assert.equal(fallback.extractEngine, 'regex');
    assert.equal(fallback.extractConfidence, null);
  });

  it('filters Needle 3 tags to ALLOWED_NOTE_TAGS and preserves confidence', () => {
    const merged = mergeCactusNoteFields('Quiet afternoon walk', 0, null, {
      matched: true,
      title: 'Afternoon walk',
      summary: 'Short break outside.',
      tags: ['  SHIP ', 'random-slop', 'IDEA', 'work'],
      actionItems: [],
      confidence: 0.87,
    });
    assert.deepEqual(merged.tags, ['ship', 'idea']);
    assert.ok(merged.tags.every((t) => (ALLOWED_NOTE_TAGS as readonly string[]).includes(t)));
    assert.equal(merged.extractEngine, 'needle3');
    assert.equal(merged.extractConfidence, 0.87);

    const fallbackTags = mergeCactusNoteFields('Need to fix crash tomorrow', 0, null, {
      matched: true,
      title: 'Fix crash',
      summary: 'Crash needs fixing.',
      tags: ['unsupported', 'misc'],
      actionItems: [],
      confidence: 0.42,
    });
    assert.deepEqual(fallbackTags.tags, ['bug', 'todo']);
    assert.equal(fallbackTags.extractConfidence, 0.42);
  });

  it('returns extractEngine none for empty voice memo', () => {
    const emptyMemo = mergeCactusNoteFields('   ', 9, 'file:///clip.m4a', {
      matched: true,
      title: 'Ignored',
      summary: 'Ignored',
      tags: ['bug'],
      actionItems: ['Ignored'],
      confidence: 0.9,
    });
    assert.equal(emptyMemo.title, 'Voice memo (00:09)');
    assert.equal(emptyMemo.extractEngine, 'none');
    assert.equal(emptyMemo.extractConfidence, null);
  });
});

describe('mergeChunkTranscripts', () => {
  it('handles empty arrays, blank chunks, and single chunks', () => {
    assert.equal(mergeChunkTranscripts([]), '');
    assert.equal(mergeChunkTranscripts(['   ', '']), '');
    assert.equal(mergeChunkTranscripts(['  Single chunk note  ']), 'Single chunk note');
  });

  it('deduplicates 1-6 overlapping boundary words across consecutive chunks', () => {
    assert.equal(
      mergeChunkTranscripts(['Fix the login crash', 'crash before release']),
      'Fix the login crash before release'
    );
    assert.equal(
      mergeChunkTranscripts([
        'Remember to verify the SQLite migration script',
        'the sqlite migration script. Then run tests',
      ]),
      'Remember to verify the SQLite migration script. Then run tests'
    );
    assert.equal(
      mergeChunkTranscripts([
        'one two three four five six seven',
        'two three four five six seven eight',
        '',
        'seven eight nine',
      ]),
      'one two three four five six seven eight nine'
    );
  });
});

describe('createMemoryNoteStore pending, update, and legacy normalization', () => {
  it('creates pending voice notes and updates fields cleanly', () => {
    const storage = createFakeStorage();
    const store = createMemoryNoteStore(storage);

    const pending = store.createPending('draft context', 15, 'file:///voice.m4a');
    assert.equal(pending.audioState, 'pending');
    assert.equal(pending.title, 'Voice note (pending)');
    assert.equal(pending.transcript, 'draft context');
    assert.equal(pending.sttEngine, 'none');
    assert.equal(pending.extractEngine, 'none');

    const textQuick = store.createPending('Todo: deploy build', 0, null);
    assert.equal(textQuick.audioState, 'none');
    assert.equal(textQuick.extractEngine, 'regex');
    assert.ok(textQuick.tags.includes('ship'));

    const updated = store.update(pending.id, {
      title: 'Updated title',
      audioState: 'done',
      sttEngine: 'whistle',
      extractEngine: 'needle3',
      extractConfidence: 0.91,
      lastError: null,
    });
    assert.equal(updated?.title, 'Updated title');
    assert.equal(updated?.audioState, 'done');
    assert.equal(updated?.sttEngine, 'whistle');
    assert.equal(updated?.extractEngine, 'needle3');
    assert.equal(updated?.extractConfidence, 0.91);
    assert.equal(store.update(999999, { title: 'Missing' }), null);

    const reloaded = createMemoryNoteStore(storage)
      .list()
      .find((n) => n.id === pending.id);
    assert.equal(reloaded?.title, 'Updated title');
    assert.equal(reloaded?.extractConfidence, 0.91);
  });

  it('defaults the 5 new metadata fields on legacy stored entries', () => {
    const storage = createFakeStorage();
    storage.setItem(
      'mono_notes_v1',
      JSON.stringify([
        {
          id: 42,
          title: 'Legacy note',
          transcript: 'Old note',
          summary: 'Old note',
          tags: ['log'],
          actionItems: [],
          durationSec: 0,
          audioUri: null,
          localDate: '2026-10-01',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ])
    );

    const [note] = createMemoryNoteStore(storage).list();
    assert.equal(note.audioState, 'none');
    assert.equal(note.sttEngine, 'none');
    assert.equal(note.extractEngine, 'none');
    assert.equal(note.extractConfidence, null);
    assert.equal(note.lastError, null);
  });
});

describe('Extraction eval set (15 voice logs)', () => {
  const cases: {
    name: string;
    transcript: string;
    audioUri?: string | null;
    durationSec?: number;
    cactus?: Parameters<typeof mergeCactusNoteFields>[3];
    expectedTags: string[];
    minActions?: number;
    exactActions?: number;
    expectedEngine?: 'needle3' | 'regex' | 'none';
  }[] = [
    {
      name: '1. crash bug report with todo',
      transcript:
        'Uh yeah the Android audio player crashes on cold start. Need to remove the 1s timeout.',
      audioUri: 'file:///1.m4a',
      expectedTags: ['voice', 'bug'],
      minActions: 1,
      expectedEngine: 'regex',
    },
    {
      name: '2. multi-item grocery and work todo',
      transcript:
        'Todo: buy USB-C cable for test phone. Must update the EAS build profile before 5pm.',
      expectedTags: ['todo', 'ship'],
      minActions: 2,
      expectedEngine: 'regex',
    },
    {
      name: '3. shipping release log',
      transcript: 'Just pushed the commit and launched preview build 14 to internal testers.',
      expectedTags: ['ship'],
      exactActions: 0,
      expectedEngine: 'regex',
    },
    {
      name: '4. meeting debrief with follow-up',
      transcript:
        'Synced with Priya about the offline vault flow. Remember to email her the schema diff.',
      expectedTags: ['people', 'todo'],
      minActions: 1,
      expectedEngine: 'regex',
    },
    {
      name: '5. paper study note',
      transcript: 'Reading the Whisper distillation paper tonight to study chunk boundary overlap.',
      expectedTags: ['study'],
      exactActions: 0,
      expectedEngine: 'regex',
    },
    {
      name: '6. product idea brainstorm',
      transcript: 'What if we explore a one-tap retry chip on pending voice notes when offline?',
      expectedTags: ['idea'],
      exactActions: 0,
      expectedEngine: 'regex',
    },
    {
      name: '7. rambling multi-sentence mixed voice log',
      transcript:
        'Okay quick note while walking. The search tab had a bug where tags were filtered in memory instead of SQL. Gotta fix that and deploy before tomorrow morning. Also talk to Sam about test fixtures.',
      audioUri: 'file:///7.m4a',
      expectedTags: ['voice', 'bug', 'ship', 'people'],
      minActions: 1,
      expectedEngine: 'regex',
    },
    {
      name: '8. empty voice memo',
      transcript: '   ',
      audioUri: 'file:///8.m4a',
      durationSec: 6,
      expectedTags: ['voice'],
      exactActions: 0,
      expectedEngine: 'none',
    },
    {
      name: '9. punctuation-only noise',
      transcript: '... --- ! ?',
      expectedTags: ['log'],
      exactActions: 0,
      expectedEngine: 'regex',
    },
    {
      name: '10. no-todo daily reflection',
      transcript:
        'Slept well, drank black coffee, and spent an hour sketching icons in my notebook.',
      expectedTags: ['log'],
      exactActions: 0,
      expectedEngine: 'regex',
    },
    {
      name: '11. debug error investigation',
      transcript:
        'Seeing a JSON parse error when reading corrupted rows. Have to guard parseJsonArray.',
      expectedTags: ['bug'],
      minActions: 1,
      expectedEngine: 'regex',
    },
    {
      name: '12. interview debrief',
      transcript: 'Finished the user interview. Should ping Maya tomorrow with the prototype link.',
      expectedTags: ['people', 'todo'],
      minActions: 1,
      expectedEngine: 'regex',
    },
    {
      name: '13. release checklist reminder',
      transcript: "Don't forget to verify PR #42 and run bun test before we ship.",
      expectedTags: ['ship', 'todo'],
      exactActions: 0,
      expectedEngine: 'regex',
    },
    {
      name: '14. study concept with todo',
      transcript: 'Need to watch the SQLite FTS5 talk and learn how prefix indexes work.',
      expectedTags: ['todo', 'study'],
      minActions: 1,
      expectedEngine: 'regex',
    },
    {
      name: '15. needle3 structured override with tag sanitization',
      transcript: 'Talked with Alex about launch timing and fixing the export crash.',
      audioUri: 'file:///15.m4a',
      cactus: {
        matched: true,
        title: 'Launch timing & export crash',
        summary: 'Discussed launch timing with Alex and export crash fix.',
        tags: ['People', 'BUG', 'invalid-tag'],
        actionItems: ['Fix export crash', 'Confirm launch date with Alex'],
        confidence: 0.93,
      },
      expectedTags: ['voice', 'people', 'bug'],
      exactActions: 2,
      expectedEngine: 'needle3',
    },
  ];

  for (const evalCase of cases) {
    it(evalCase.name, () => {
      const direct = extractStructuredNote(evalCase.transcript);
      assert.ok(direct.tags.length >= 1);

      const merged = mergeCactusNoteFields(
        evalCase.transcript,
        evalCase.durationSec ?? 10,
        evalCase.audioUri ?? null,
        evalCase.cactus ?? null
      );

      for (const expectedTag of evalCase.expectedTags) {
        assert.ok(
          merged.tags.includes(expectedTag),
          `Expected tag "${expectedTag}" in [${merged.tags.join(', ')}]`
        );
      }
      if (evalCase.minActions !== undefined) {
        assert.ok(
          merged.actionItems.length >= evalCase.minActions,
          `Expected at least ${evalCase.minActions} actions, got ${merged.actionItems.length}`
        );
      }
      if (evalCase.exactActions !== undefined) {
        assert.equal(merged.actionItems.length, evalCase.exactActions);
      }
      if (evalCase.expectedEngine !== undefined) {
        assert.equal(merged.extractEngine, evalCase.expectedEngine);
      }
    });
  }
});

describe('filterNotes tag query matching', () => {
  it('matches #tag terms against note.tags and literal wildcards without false positives', () => {
    const store = createMemoryNoteStore(createFakeStorage());
    const bugNote = store.create('Crash when saving offline clip');
    const studyNote = store.create('Read paper about audio resampling');

    const all = store.list();
    assert.deepEqual(
      filterNotes(all, '#bug').map((n) => n.id),
      [bugNote.id]
    );
    assert.deepEqual(
      filterNotes(all, '#study audio').map((n) => n.id),
      [studyNote.id]
    );
    assert.deepEqual(filterNotes(all, '%'), []);
  });
});
