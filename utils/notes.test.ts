import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALLOWED_NOTE_TAGS,
  buildNoteFields,
  combineDraftAndTranscript,
  computeStreak,
  filterNotes,
  formatDuration,
  formatLocalDate,
  mergeCactusNoteFields,
  mergeChunkTranscripts,
  MonoNote,
  toggleActionInList,
} from './notes';

function makeSampleNote(overrides: Partial<MonoNote> = {}): MonoNote {
  return {
    id: 1,
    title: 'Sample note',
    transcript: 'Sample transcript',
    summary: '',
    tags: ['log'],
    actionItems: [],
    durationSec: 0,
    audioUri: null,
    audioState: 'none',
    sttEngine: 'none',
    extractEngine: 'none',
    extractConfidence: null,
    lastError: null,
    localDate: '2026-11-25',
    createdAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildNoteFields', () => {
  it('builds a voice memo entry when audio has no transcript', () => {
    const fields = buildNoteFields('   ', 12, 'file:///recordings/clip-1.m4a');
    assert.equal(fields.title, 'Voice memo (00:12)');
    assert.equal(fields.transcript, '');
    assert.deepEqual(fields.tags, ['voice']);
    assert.deepEqual(fields.actionItems, []);
  });

  it('truncates long plain text titles and assigns default tags', () => {
    const voice = buildNoteFields(
      'One two three four five six seven eight nine',
      7,
      'file:///recordings/clip-1.m4a'
    );
    assert.equal(voice.title, 'One two three four five six seven...');
    assert.deepEqual(voice.tags, ['voice']);

    const text = buildNoteFields('Short note', 0, null);
    assert.equal(text.title, 'Short note');
    assert.deepEqual(text.tags, ['log']);
  });
});

describe('computeStreak and formatters', () => {
  it('counts consecutive active days ending today or yesterday', () => {
    const today = new Date(2026, 10, 25, 12, 0, 0);
    const makeDayNote = (offsetDays: number, id: number): MonoNote => {
      const d = new Date(today);
      d.setDate(d.getDate() - offsetDays);
      return makeSampleNote({
        id,
        localDate: formatLocalDate(d),
        createdAt: d.toISOString(),
      });
    };

    assert.equal(computeStreak([], today), 0);
    assert.equal(
      computeStreak(
        [makeDayNote(0, 1), makeDayNote(1, 2), makeDayNote(2, 3), makeDayNote(4, 4)],
        today
      ),
      3
    );
    assert.equal(computeStreak([makeDayNote(1, 1), makeDayNote(2, 2)], today), 2);
    assert.equal(computeStreak([makeDayNote(2, 1)], today), 0);
  });

  it('formats durations cleanly', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(65), '01:05');
    assert.equal(formatDuration(-3), '00:00');
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

  it('uses Needle 3 structured extraction and prefixes #voice for audio notes', () => {
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
    assert.equal(merged.extractEngine, 'needle3');
  });

  it('returns extractEngine none when Needle 3 did not match', () => {
    const unextracted = mergeCactusNoteFields('Todo: fix login crash tomorrow.', 0, null, {
      matched: false,
      title: '',
      summary: '',
      tags: [],
      actionItems: [],
    });
    assert.equal(unextracted.title, 'Todo: fix login crash tomorrow.');
    assert.deepEqual(unextracted.tags, ['log']);
    assert.deepEqual(unextracted.actionItems, []);
    assert.equal(unextracted.extractEngine, 'none');
    assert.equal(unextracted.extractConfidence, null);
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

    const defaultedTags = mergeCactusNoteFields('Need to fix crash tomorrow', 0, null, {
      matched: true,
      title: 'Fix crash',
      summary: 'Crash needs fixing.',
      tags: ['unsupported', 'misc'],
      actionItems: [],
      confidence: 0.42,
    });
    assert.deepEqual(defaultedTags.tags, ['log']);
    assert.equal(defaultedTags.extractConfidence, 0.42);
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

describe('filterNotes and action item toggles', () => {
  it('matches keywords, #tag terms, and literal wildcards without false positives', () => {
    const bugNote = makeSampleNote({
      id: 1,
      title: 'Offline clip crash',
      tags: ['voice', 'bug'],
      actionItems: [{ id: 'a1', text: 'Check MediaRecorder stop', done: false }],
    });
    const studyNote = makeSampleNote({
      id: 2,
      title: 'Audio resampling notes',
      transcript: 'Read paper about audio resampling',
      tags: ['study'],
    });
    const all = [bugNote, studyNote];

    assert.deepEqual(
      filterNotes(all, '#bug').map((n) => n.id),
      [bugNote.id]
    );
    assert.deepEqual(
      filterNotes(all, '#study audio').map((n) => n.id),
      [studyNote.id]
    );
    assert.deepEqual(
      filterNotes(all, 'mediarecorder').map((n) => n.id),
      [bugNote.id]
    );
    assert.deepEqual(filterNotes(all, '%'), []);
  });

  it('toggles matching action items immutably', () => {
    const items = [
      { id: 'a1', text: 'First task', done: false },
      { id: 'a2', text: 'Second task', done: false },
    ];
    const toggled = toggleActionInList(items, 'a1');
    assert.equal(toggled[0].done, true);
    assert.equal(toggled[1].done, false);
    assert.equal(items[0].done, false);
  });
});
