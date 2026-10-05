import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  snag,
  snagClosure,
  snapshot,
  stage,
  worked,
} from '../__fixtures__/plan';
import type { Photo } from '../diary';
import type { Check, CheckAnswer, Document, WorkSnapshot } from '../plan';
import { handover } from './handover';
import {
  STORY_KIND_KEYS,
  STORY_LABEL_KEYS,
  STORY_MESSAGE_KEYS,
  allotStory,
  photoStory,
  pickStory,
  storyBudget,
  type Story,
  type StoryPhoto,
} from './story';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────

/** A hash the work can name: the label, ended by `z` so no label is another's prefix, padded. */
const h = (label: string) => `${label}z`.padEnd(64, '0');

function document(label: string, parts: Partial<Document> = {}): Document {
  return {
    id: `doc-${label}`,
    fileHash: h(label),
    fileName: `${label}.jpg`,
    mediaType: 'image/jpeg',
    bytes: 2_048,
    width: 800,
    height: 600,
    kind: 'photo',
    title: `Title ${label}`,
    addedOn: '2026-09-10',
    authorName: 'Sample author',
    createdAt: '2026-09-10T12:00:00.000Z',
    links: [],
    ...parts,
  };
}

const photo = (label: string): Photo => ({
  fileHash: h(label),
  fileName: `${label}.jpg`,
  bytes: 2_048,
  width: 800,
  height: 600,
  thumbnail: true,
});

const check = (id: string, stageId: string, position: number, needsPhoto = true): Check => ({
  id,
  stageId,
  gate: 'close',
  position,
  name: `Check ${id}`,
  needsPhoto,
});

const answer = (checkId: string, seq: number, label: string, day: string): CheckAnswer => ({
  id: `answer-${checkId}-${seq}`,
  checkId,
  seq,
  answer: 'yes',
  reason: null,
  photoHash: h(label),
  authorName: 'Sample author',
  answeredAt: `${day}T15:00:00.000Z`,
});

const hashes = (photos: readonly StoryPhoto[]) =>
  photos.map((each) => each.photoHash.slice(0, each.photoHash.indexOf('z')));

const sectionsOf = (story: Story) =>
  story.sections.map((section) => [section.key, hashes(section.photos)]);

// ── A work with rooms ────────────────────────────────────────────────────────

/**
 * Two rooms: plumbing runs through both and has a hidden-work check; tiling is the bathroom's and
 * has one activity in no room. A snag on the kitchen's plumbing, another on the tiling stage.
 */
const HOUSE: WorkSnapshot = snapshot({
  rooms: [
    { id: 'kitchen', position: 2, name: 'Kitchen' },
    { id: 'bath', position: 1, name: 'Bathroom' },
  ],
  stages: [stage('plumbing', 1, 'Plumbing'), stage('tiling', 2, 'Tiling')],
  activities: [
    { ...activity('pipes', 'plumbing', 1, 3), name: 'Run pipes', roomIds: ['kitchen', 'bath'] },
    { ...activity('sink', 'plumbing', 2, 1), name: 'Fit sink', roomIds: ['kitchen'] },
    { ...activity('walls', 'tiling', 1, 4), name: 'Tile walls', roomIds: ['bath'] },
    { ...activity('clean', 'tiling', 2, 1), name: 'Clean up' },
  ],
  checks: [check('sealed', 'plumbing', 1), check('ordinary', 'plumbing', 2, false)],
  checkAnswers: [
    answer('sealed', 1, 'pressure', '2026-09-04'),
    answer('ordinary', 1, 'ordinary', '2026-09-04'),
  ],
  snags: [
    snag('drip', 1, 'plumbing', {
      activityId: 'sink',
      photoHash: h('drip'),
      raisedOn: '2026-10-02',
      closure: snagClosure('fixed', '2026-10-05', h('dry')),
    }),
    snag('chip', 2, 'tiling', { photoHash: h('chip'), raisedOn: '2026-10-03' }),
    snag('oops', 3, 'tiling', {
      photoHash: h('oops'),
      closure: snagClosure('withdrawn', '2026-10-03'),
    }),
  ],
  documents: [
    'pressure',
    'ordinary',
    'drip',
    'dry',
    'chip',
    'oops',
    'empty',
    'pipes',
    'sink',
    'tiles',
    'yard',
    'dust',
  ].map((label) => document(label)),
});

const HOUSE_DIARY = [
  entry(1, '2026-09-01', { photos: [photo('empty'), photo('missing')] }),
  entry(2, '2026-09-03', { done: [worked('pipes')], photos: [photo('pipes')] }),
  entry(3, '2026-09-20', { done: [worked('sink')], photos: [photo('sink')] }),
  entry(4, '2026-10-04', { done: [worked('walls'), worked('clean')], photos: [photo('tiles')] }),
  entry(5, '2026-10-05', { done: [worked('ghost')], photos: [photo('yard')] }),
];

describe('the work told in photos, by room', () => {
  const story = photoStory(HOUSE, HOUSE_DIARY);

  it('tells each room first to last, then what touches no room', () => {
    expect(story.by).toBe('room');
    expect(sectionsOf(story)).toEqual([
      ['room:bath', ['pipes', 'pressure', 'chip', 'tiles']],
      ['room:kitchen', ['pipes', 'pressure', 'sink', 'drip', 'dry']],
      // The tiling snag names no activity: it is told wherever its stage is. Then an entry naming
      // no activity, the activity in no room, and an entry naming only what the plan does not have.
      ['other', ['empty', 'chip', 'tiles', 'yard']],
    ]);
    expect(story.count).toBe(9);
  });

  it('says what each photo is, for its caption', () => {
    const [bath, kitchen, other] = story.sections;
    expect(bath!.photos[1]).toEqual({
      photoHash: h('pressure'),
      fileName: 'pressure.jpg',
      day: '2026-09-04',
      kind: 'hidden-work',
      entrySeq: null,
      activityNames: [],
      stageName: 'Plumbing',
      checkName: 'Check sealed',
      snagNumber: null,
      snagTitle: null,
    });
    expect(kitchen!.photos.slice(3).map((each) => [each.kind, each.day, each.snagNumber])).toEqual([
      ['snag-problem', '2026-10-02', 1],
      ['snag-fix', '2026-10-05', 1],
    ]);
    expect(kitchen!.photos[3]).toMatchObject({
      activityNames: ['Fit sink'],
      snagTitle: 'Snag drip',
      stageName: 'Plumbing',
    });
    // The same entry names an activity of the bathroom and one in no room: each is told where it is.
    expect(bath!.photos[3]).toMatchObject({ activityNames: ['Tile walls'], stageName: 'Tiling' });
    expect(other!.photos[2]).toMatchObject({ activityNames: ['Clean up'], entrySeq: 4 });
    expect(other!.photos[0]).toMatchObject({ kind: 'diary', activityNames: [], stageName: null });
  });

  it('gives each section its first and last day, its count and the months it spans', () => {
    expect(
      story.sections.map((each) => [each.first, each.last, each.count, each.months, each.labelKey]),
    ).toEqual([
      ['2026-09-03', '2026-10-04', 4, 2, null],
      ['2026-09-03', '2026-10-05', 5, 2, null],
      ['2026-09-01', '2026-10-05', 4, 2, STORY_LABEL_KEYS.other],
    ]);
    expect(story.sections[0]).toMatchObject({ kind: 'room', id: 'bath', name: 'Bathroom' });
    expect(story.sections[2]).toMatchObject({ kind: 'other', id: null, name: null });
  });

  it('never tells a photo the work does not hold, one on an ordinary check, or a withdrawn snag', () => {
    const all = story.sections.flatMap((each) => hashes(each.photos));
    expect(all).not.toContain('missing');
    expect(all).not.toContain('ordinary');
    expect(all).not.toContain('oops');
    const pdf = {
      ...HOUSE,
      documents: HOUSE.documents.map((each) =>
        each.id === 'doc-sink' ? { ...each, width: null, height: null } : each,
      ),
    };
    expect(hashes(photoStory(pdf, HOUSE_DIARY).sections[1]!.photos)).not.toContain('sink');
  });

  it('puts the same photos in the same sections as the handover book', () => {
    const book = handover(HOUSE, HOUSE_DIARY);
    expect(book.sections.map((each) => each.key)).toEqual(story.sections.map((each) => each.key));
    for (const told of story.sections) {
      const section = book.sections.find((each) => each.key === told.key)!;
      const inBook = [
        ...section.hiddenWork.map((each) => each.photoHash),
        ...section.snagsFixed.flatMap((row) =>
          [row.before, row.after].flatMap((each) => (each === null ? [] : [each.photoHash])),
        ),
        ...section.photos.map((each) => each.photoHash),
      ];
      expect(new Set(inBook)).toEqual(new Set(told.photos.map((each) => each.photoHash)));
      expect(section.storyCount).toBe(section.photos.length + section.photosNotShown);
    }
  });

  it('is nothing for a work with no photo', () => {
    // Hidden work and snags are told without a diary.
    expect(photoStory(HOUSE, [])).toMatchObject({ by: 'room', count: 4 });
    const bare = { ...HOUSE, checkAnswers: [], snags: [] };
    expect(photoStory(bare, [])).toEqual({ by: 'room', sections: [], count: 0 });
    expect(photoStory(snapshot(), [])).toEqual({ by: 'stage', sections: [], count: 0 });
  });
});

// ── A work without rooms ─────────────────────────────────────────────────────

describe('the work told in photos, by stage', () => {
  const plan = snapshot({
    stages: [stage('b', 2, 'Roof'), stage('a', 1, 'Walls')],
    activities: [
      { ...activity('a1', 'a', 1, 2), name: 'Lay blocks' },
      { ...activity('b1', 'b', 1, 2), name: 'Tiles' },
      { ...activity('lost', 'gone', 1, 2), name: 'Orphan' },
    ],
    documents: ['wall', 'roof', 'site', 'orphan'].map((label) => document(label)),
  });

  it('tells each stage in stage order, then the whole work for what no stage takes', () => {
    const story = photoStory(plan, [
      entry(1, '2026-09-02', { done: [worked('b1')], photos: [photo('roof')] }),
      entry(2, '2026-09-01', { done: [worked('a1')], photos: [photo('wall')] }),
      entry(3, '2026-09-03', { photos: [photo('site')] }),
      // An activity whose stage is gone: no stage takes it.
      entry(4, '2026-09-04', { done: [worked('lost')], photos: [photo('orphan')] }),
    ]);
    expect(story.by).toBe('stage');
    expect(sectionsOf(story)).toEqual([
      ['stage:a', ['wall']],
      ['stage:b', ['roof']],
      ['work', ['site', 'orphan']],
    ]);
    expect(story.sections[2]).toMatchObject({
      kind: 'work',
      id: null,
      name: null,
      labelKey: STORY_LABEL_KEYS.work,
    });
    // In the last section, an entry's activities are still named, in plan order.
    expect(story.sections[2]!.photos.map((each) => each.activityNames)).toEqual([[], ['Orphan']]);
  });

  it('has no last section when everything has its stage', () => {
    const story = photoStory(plan, [
      entry(1, '2026-09-02', { done: [worked('a1')], photos: [photo('wall')] }),
    ]);
    expect(story.sections.map((each) => each.key)).toEqual(['stage:a']);
  });
});

// ── Order, and the record as it stands ───────────────────────────────────────

describe('the order of a story', () => {
  const plan = snapshot({
    stages: [stage('s', 1, 'Finishes')],
    activities: [activity('x', 's', 1, 2)],
    checks: [check('k2', 's', 2), check('k1', 's', 1)],
    checkAnswers: [
      answer('k2', 1, 'k2', '2026-09-05'),
      answer('k1', 2, 'k1-late', '2026-09-05'),
      answer('k1', 1, 'k1', '2026-09-05'),
    ],
    snags: [
      snag('two', 2, 's', { photoHash: h('two'), raisedOn: '2026-09-05' }),
      snag('one', 1, 's', {
        photoHash: h('one'),
        raisedOn: '2026-09-01',
        closure: snagClosure('fixed', '2026-09-05', h('one-fixed')),
      }),
    ],
    documents: ['k1', 'k1-late', 'k2', 'two', 'one', 'one-fixed', 'e1', 'e2', 'e3', 'old'].map(
      (label) => document(label),
    ),
  });

  it('sorts a day by kind — hidden work, a snag found, a snag fixed, the diary — then seq, then place', () => {
    const story = photoStory(plan, [
      entry(2, '2026-09-05', { done: [worked('x')], photos: [photo('e3')] }),
      entry(1, '2026-09-05', { done: [worked('x')], photos: [photo('e1'), photo('e2')] }),
    ]);
    expect(hashes(story.sections[0]!.photos)).toEqual([
      'one',
      'k1',
      'k1-late',
      'k2',
      'two',
      'one-fixed',
      'e1',
      'e2',
      'e3',
    ]);
  });

  it('tells a photo once per section, where it first comes', () => {
    const story = photoStory(plan, [
      entry(1, '2026-09-02', { done: [worked('x')], photos: [photo('k2'), photo('e1')] }),
      entry(2, '2026-09-06', { done: [worked('x')], photos: [photo('e1')] }),
    ]);
    const photos = story.sections[0]!.photos;
    expect(photos.filter((each) => each.photoHash === h('e1'))).toHaveLength(1);
    expect(photos.find((each) => each.photoHash === h('k2'))).toMatchObject({
      kind: 'diary',
      day: '2026-09-02',
    });
  });

  it('reads only the entries that speak for their day', () => {
    const story = photoStory(plan, [
      entry(1, '2026-09-02', { done: [worked('x')], photos: [photo('old')] }),
      correction(2, 1, '2026-09-02', { done: [worked('x')], photos: [photo('e1')] }),
    ]);
    const all = hashes(story.sections[0]!.photos);
    expect(all).toContain('e1');
    expect(all).not.toContain('old');
  });

  it('is the same on every call', () => {
    const entries = [entry(1, '2026-09-02', { done: [worked('x')], photos: [photo('e1')] })];
    expect(photoStory(plan, entries)).toEqual(photoStory(plan, [...entries]));
  });

  it('names its messages', () => {
    expect(STORY_KIND_KEYS).toEqual({
      diary: 'story.kind.diary',
      'hidden-work': 'story.kind.hiddenWork',
      'snag-problem': 'story.kind.snagProblem',
      'snag-fix': 'story.kind.snagFix',
    });
    expect(STORY_MESSAGE_KEYS).toEqual([
      'story.kind.diary',
      'story.kind.hiddenWork',
      'story.kind.snagProblem',
      'story.kind.snagFix',
      'story.section.other',
      'story.section.work',
    ]);
  });
});

// ── Picking ──────────────────────────────────────────────────────────────────

describe('picking a story', () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('shows everything that fits', () => {
    expect(pickStory([], 12)).toEqual({ shown: [], notShown: 0 });
    expect(pickStory([0], 12)).toEqual({ shown: [0], notShown: 0 });
    expect(pickStory([0, 1], 12)).toEqual({ shown: [0, 1], notShown: 0 });
    expect(pickStory(range(12), 12)).toEqual({ shown: range(12), notShown: 0 });
  });

  it('keeps the first and the last one past the limit', () => {
    const picked = pickStory(range(13), 12);
    expect(picked.notShown).toBe(1);
    expect(picked.shown[0]).toBe(0);
    expect(picked.shown.at(-1)).toBe(12);
    expect(picked.shown).toHaveLength(12);
  });

  it('spaces the rest evenly by position', () => {
    // round(i × 99 / 11), i = 0 … 11.
    expect(pickStory(range(100), 12)).toEqual({
      shown: [0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99],
      notShown: 88,
    });
    expect(pickStory(range(5), 2)).toEqual({ shown: [0, 4], notShown: 3 });
    expect(pickStory(range(5), 3)).toEqual({ shown: [0, 2, 4], notShown: 2 });
  });

  it('shows the first only under two, and nothing at none', () => {
    expect(pickStory(range(5), 1)).toEqual({ shown: [0], notShown: 4 });
    expect(pickStory(range(5), 0)).toEqual({ shown: [], notShown: 5 });
    expect(pickStory(range(5), -3)).toEqual({ shown: [], notShown: 5 });
  });

  it('picks the same every time, in story order, each once', () => {
    for (const n of [13, 37, 100, 401]) {
      for (const limit of [2, 3, 7, 12, 30].filter((each) => each < n)) {
        const first = pickStory(range(n), limit);
        expect(pickStory(range(n), limit)).toEqual(first);
        expect(first.shown).toHaveLength(limit);
        expect(new Set(first.shown).size).toBe(limit);
        expect([...first.shown].sort((a, b) => a - b)).toEqual(first.shown);
        expect(first.shown[0]).toBe(0);
        expect(first.shown.at(-1)).toBe(n - 1);
        expect(first.notShown).toBe(n - limit);
      }
    }
  });
});

describe('a budget over a story', () => {
  it('gives each section its first and last before any its third, then round by round', () => {
    expect(allotStory([20, 1, 5, 0, 30], 12, 9)).toEqual([4, 1, 4, 0, 3]);
    expect(allotStory([20, 1, 5, 0, 30], 100, 9)).toEqual([9, 1, 5, 0, 9]);
    // Too little for two each: the earlier sections first.
    expect(allotStory([5, 5, 5], 4, 9)).toEqual([2, 1, 1]);
    expect(allotStory([5, 5, 5], 0, 9)).toEqual([0, 0, 0]);
    expect(allotStory([5, 5, 5], -1, 9)).toEqual([0, 0, 0]);
    expect(allotStory([], 30, 9)).toEqual([]);
  });

  it('picks each section with its share, within the total, the same every time', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const rooms = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id,
      position: i + 1,
      name: `Room ${id}`,
    }));
    const plan = snapshot({
      rooms,
      stages: [stage('s', 1, 'All')],
      activities: rooms.map((room, i) => ({
        ...activity(`x${i}`, 's', i + 1, 2),
        roomIds: [room.id],
      })),
      documents: labels.map((label) => document(label)),
    });
    // Room a: 25 photos, b: 2, c: 13, d: none.
    const counts = [25, 2, 13];
    let next = 0;
    const diary = counts.flatMap((count, room) =>
      Array.from({ length: count }, (_, i) =>
        entry(next + 1, `2026-09-${String(i + 1).padStart(2, '0')}`, {
          done: [worked(`x${room}`)],
          photos: [photo(labels[next++]!)],
        }),
      ),
    );
    const story = photoStory(plan, diary);
    expect(story.sections.map((each) => [each.key, each.count])).toEqual([
      ['room:a', 25],
      ['room:b', 2],
      ['room:c', 13],
    ]);
    const rows = storyBudget(story, 15, 9);
    expect(
      rows.map((row) => [row.section.key, row.allotted, row.shown.length, row.notShown]),
    ).toEqual([
      ['room:a', 7, 7, 18],
      ['room:b', 2, 2, 0],
      ['room:c', 6, 6, 7],
    ]);
    expect(rows.reduce((sum, row) => sum + row.shown.length, 0)).toBe(15);
    for (const row of rows) {
      expect(row.shown[0]).toBe(row.section.photos[0]);
      expect(row.shown.at(-1)).toBe(row.section.photos.at(-1));
    }
    expect(storyBudget(story, 15, 9)).toEqual(rows);
    // Plenty: every section up to its cap.
    expect(storyBudget(story, 30, 9).map((row) => row.shown.length)).toEqual([9, 2, 9]);
  });
});
