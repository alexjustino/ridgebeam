/**
 * A meeting's minutes, as a document (G1, decision 4): the minutes the work holds — written once, at
 * the meeting's close, and never edited — turned into blocks for the F10 renderer, in the language on
 * screen and **always in the owner's words**, as the weekly report and the handover book are: the
 * minutes are handed round to everyone at the table.
 *
 * In order: the meeting's number and the day it was held, and who wrote it; **who was there**; **the
 * agenda** — each item with what was said and what was done in the meeting, in the words the meeting
 * screen wrote from the command that ran ("Decision made: White oak"); **the actions** raised, each
 * with who and by when; **the actions closed** at this meeting, each with the meeting that raised it;
 * the notes, whole; and the honesty line — minutes are a record, not a signature, as the diary's own
 * line says of its chain.
 *
 * What the page leaves out it says: an item with nothing said reads _nothing noted_, a meeting with
 * no action raised says so — never an empty table that could be a page that failed to print.
 *
 * Pure: the meeting, the work and an `I18n` in; a `ReportDocument` out. No clock, no host.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';
import { MEETING_ACTION_STATE_KEYS } from '@/domain/meetings';
import type { Meeting, WorkSnapshot } from '@/domain/plan';
import { actionWhoText, attendeeName, kindText } from '@/features/meeting/meetingWords';
import type { MessageKey } from '@/i18n/en';
import { termsFor } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { finished, pieces, tableRows } from './document';

/** The minutes of `meeting` in `i18n`'s language and the owner's words. */
export function composeMinutes(
  meeting: Meeting,
  snapshot: WorkSnapshot,
  i18n: I18n,
): ReportDocument {
  const { t, day } = i18n;
  const term = termsFor(i18n.language, 'owner');
  const minutes = term('meetingMinutes', { capital: true });
  const blocks: ReportBlock[] = [];

  blocks.push({
    type: 'paragraph',
    tone: 'strong',
    text: t('reports.minutes.doc.held', {
      number: meeting.number,
      day: day(meeting.heldOn),
      author: meeting.authorName,
    }),
  });

  // ── Who was there ──
  blocks.push({ type: 'heading', level: 2, text: t('meeting.attendees.title') });
  blocks.push({
    type: 'paragraph',
    text:
      meeting.attendees.length === 0
        ? t('reports.minutes.doc.attendeesNone')
        : [...meeting.attendees]
            .sort((a, b) => a.position - b.position)
            .map((attendee) => attendeeName(i18n, snapshot, attendee))
            .join(', '),
  });

  // ── The agenda: what was said, what was done ──
  blocks.push({ type: 'heading', level: 2, text: t('meeting.agenda.title') });
  const items = [...meeting.items].sort((a, b) => a.position - b.position);
  if (items.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.minutes.doc.agendaNone') });
  } else {
    blocks.push({
      type: 'table',
      columns: [
        { text: t('reports.minutes.col.item'), align: 'left', width: 0.34 },
        { text: t('meeting.item.note'), align: 'left', width: 0.4 },
        { text: t('reports.minutes.col.done'), align: 'left', width: 0.26 },
      ],
      rows: tableRows(
        items.map((item) => [
          t('reports.minutes.item', {
            section: kindText(i18n, item.kind),
            title: item.title,
          }),
          item.note === null || item.note.trim() === ''
            ? t('reports.minutes.doc.nothingSaid')
            : item.note,
          item.outcome === null || item.outcome.trim() === ''
            ? t('reports.minutes.doc.nothingDone')
            : item.outcome,
        ]),
      ),
    });
  }

  // ── The actions raised ──
  blocks.push({
    type: 'heading',
    level: 2,
    text: t('reports.minutes.doc.actions'),
  });
  const actions = [...meeting.actions].sort((a, b) => a.position - b.position);
  if (actions.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.minutes.doc.actionsNone') });
  } else {
    blocks.push({
      type: 'table',
      columns: [
        { text: t('meeting.action.text'), align: 'left', width: 0.5 },
        { text: t('meeting.action.person'), align: 'left', width: 0.25 },
        { text: t('meeting.action.due'), align: 'left', width: 0.25 },
      ],
      rows: tableRows(
        actions.map((action) => [
          action.text,
          actionWhoText(i18n, snapshot, action),
          // The minutes say the day as it was set: whether it is now past is the next agenda's.
          action.dueOn === null ? t('meeting.action.noDue') : day(action.dueOn),
        ]),
      ),
    });
  }

  // ── The actions closed at this meeting ──
  blocks.push({ type: 'heading', level: 2, text: t('reports.minutes.doc.closed') });
  const closed = snapshot.meetings.flatMap((raisedAt) =>
    raisedAt.actions
      .filter((action) => action.closure !== null && action.closure.meetingId === meeting.id)
      .map((action) => ({ action, raisedAt })),
  );
  if (closed.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.minutes.doc.closedNone') });
  } else {
    for (const { action, raisedAt } of closed) {
      blocks.push({
        type: 'paragraph',
        text: [
          action.text,
          actionWhoText(i18n, snapshot, action),
          t(MEETING_ACTION_STATE_KEYS[action.closure?.outcome ?? 'open'] as MessageKey),
          t('reports.minutes.doc.raisedAt', { number: raisedAt.number }),
          action.closure?.note ?? '',
        ]
          .filter((part) => part.trim() !== '')
          .join(' — '),
      });
    }
  }

  // ── The notes, whole ──
  blocks.push({ type: 'heading', level: 2, text: t('meeting.notes') });
  if (meeting.notes === null || meeting.notes.trim() === '') {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.minutes.doc.notesNone') });
  } else {
    blocks.push(
      ...pieces(meeting.notes).map((piece): ReportBlock => ({ type: 'paragraph', text: piece })),
    );
  }

  // ── What the minutes are ──
  blocks.push({ type: 'rule' });
  blocks.push({
    type: 'paragraph',
    tone: 'muted',
    text: t('reports.minutes.doc.record', { minutes: term('meetingMinutes') }),
  });

  return finished({
    kind: 'minutes',
    title: t('reports.minutes.doc.title', { minutes, number: meeting.number }),
    subtitle: t('reports.minutes.doc.subtitle', {
      work: snapshot.work.name,
      day: day(meeting.heldOn),
    }),
    pageSize: 'a4',
    language: i18n.language,
    blocks,
  });
}
