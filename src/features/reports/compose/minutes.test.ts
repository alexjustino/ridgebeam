import { describe, expect, it } from 'vitest';

import {
  actionClosure,
  meeting,
  meetingAction,
  person,
  snapshot,
  stage,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { LANGUAGES } from '@/i18n/index';
import { termFor } from '@/i18n/terms';
import { build } from '@/i18n/useI18n';

import { stringsOf } from './document';
import { composeMinutes } from './minutes';
import { composeSnapshot } from './snapshot';

/**
 * The minutes as a PDF (G1, decision 4), in both languages and the owner's words: the meeting's
 * number and day, who was there, each item with what was said and done, the actions raised with who
 * and by when, the actions closed at the meeting with the one that raised them, the notes, and the
 * honesty line — and what is empty said as empty. The owner's snapshot gains "Last meeting" once a
 * meeting has been held, and says nothing of meetings before.
 */

const WORK: WorkSnapshot = snapshot({
  work: { ...snapshot().work, name: 'Sample kitchen' },
  people: [person('p1', 'Sample tiler'), person('p2', 'Sample painter')],
  stages: [stage('s1', 1, 'Walls')],
  meetings: [
    meeting('mt1', 1, '2026-09-04', {
      actions: [
        meetingAction('x1', 'mt1', 1, {
          text: 'Send the tile samples',
          personId: 'p1',
          closure: actionClosure('done', '2026-09-09', 'mt2'),
        }),
      ],
    }),
    meeting('mt2', 2, '2026-09-09', {
      notes: 'Next meeting on site.',
      attendees: [
        { position: 1, personId: 'p1', name: null },
        { position: 2, personId: null, name: 'Sample architect' },
      ],
      items: [
        {
          position: 1,
          kind: 'decision',
          refId: 'd1',
          title: 'Choose the floor',
          note: 'The owner chose on the spot.',
          outcome: 'Decision made: White oak',
        },
        { position: 2, kind: 'snag', refId: 'n1', title: 'Crack', note: null, outcome: null },
      ],
      actions: [
        meetingAction('x2', 'mt2', 1, {
          text: 'Order the paint',
          personId: 'p2',
          dueOn: '2026-09-11',
        }),
        meetingAction('x3', 'mt2', 2, { text: 'Measure the window' }),
      ],
    }),
  ],
});

describe.each(LANGUAGES)('the minutes, in %s', (language) => {
  const i18n = build(language, language);
  const { t, day } = i18n;
  const minutes = WORK.meetings[1]!;

  it('prints the meeting, who was there, what was said and done, and the actions', () => {
    const document = composeMinutes(minutes, WORK, i18n);
    expect(document.kind).toBe('minutes');
    expect(document.language).toBe(language);
    const words = stringsOf(document).join('\n');
    const term = termFor(language, 'owner', 'meetingMinutes');
    expect(document.title).toContain(term.charAt(0).toLocaleUpperCase(language));
    expect(words).toContain(day('2026-09-09'));
    expect(words).toContain('Sample tiler, Sample architect');
    expect(words).toContain('The owner chose on the spot.');
    expect(words).toContain('Decision made: White oak');
    expect(words).toContain(t('reports.minutes.doc.nothingSaid'));
    expect(words).toContain(t('reports.minutes.doc.nothingDone'));
    expect(words).toContain('Order the paint');
    expect(words).toContain('Sample painter');
    expect(words).toContain(day('2026-09-11'));
    expect(words).toContain(t('meeting.action.nobody'));
    // The action from meeting #1, closed here, with the meeting that raised it.
    expect(words).toContain('Send the tile samples');
    expect(words).toContain(t('reports.minutes.doc.raisedAt', { number: 1 }));
    expect(words).toContain('Next meeting on site.');
    expect(words).toContain(t('reports.minutes.doc.record', { minutes: term }));
    // Every string printable: no `?` stood in for a character the page cannot hold.
    expect(words).not.toContain('?');
  });

  it('says what is empty rather than printing nothing', () => {
    const document = composeMinutes(WORK.meetings[0]!, WORK, i18n);
    const words = stringsOf(document).join('\n');
    expect(words).toContain(t('reports.minutes.doc.attendeesNone'));
    expect(words).toContain(t('reports.minutes.doc.agendaNone'));
    expect(words).toContain(t('reports.minutes.doc.closedNone'));
    expect(words).toContain(t('reports.minutes.doc.notesNone'));
  });

  it('puts the last meeting in the owner’s snapshot, and nothing before the first', () => {
    const compose = (of: WorkSnapshot) => {
      const scheduled = schedule(of);
      return stringsOf(
        composeSnapshot(
          {
            snapshot: of,
            scheduled,
            entries: [],
            probability: finishProbability(of, scheduled, { entries: [] }),
            today: '2026-09-12',
          },
          i18n,
        ),
      );
    };
    const held = compose(WORK);
    expect(held).toContain(t('reports.snapshot.meeting.title'));
    expect(held).toContain(
      t('reports.snapshot.meeting.held', { number: 2, day: day('2026-09-09') }),
    );
    expect(held).toContain(t('meetings.figure.open'));
    expect(held.some((each) => each.startsWith('Order the paint — Sample painter'))).toBe(true);
    const none = compose({ ...WORK, meetings: [] });
    expect(none).not.toContain(t('reports.snapshot.meeting.title'));
  });
});
