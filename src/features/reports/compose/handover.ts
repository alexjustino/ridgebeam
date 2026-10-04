/**
 * The handover book, as a document (D3): the domain's selection (`reports/handover.ts`) turned into
 * blocks, in the language on screen and **always in the owner's words** — the book is the owner's,
 * whatever lens is on screen, so its nouns come from the owner's vocabulary table
 * (`termsFor(language, 'owner')`), as the weekly report's do.
 *
 * In order, as decision 5 lays it out:
 *
 * - **the cover**: "Written while the work was in progress" first, in strong type, while any stage
 *   is open; the place, the start, the finish or that it is in progress, where the plan came from,
 *   what the book holds and what it does not, **what it still lacks** — the gaps figure, with its
 *   rows, printed with its zero — and the people by trade;
 * - **a section per room** (or per stage when the work has no rooms; "everything else" last when
 *   something touches no room): its stages and where they are, what was done and when, the decisions
 *   made, **the photos of hidden work** — each full width, captioned with the check, its stage and
 *   the day — then, once the work has had a snag (E4), **the snags fixed** there, each with the photo
 *   of the problem and the photo of the fix side by side, half width — then the diary's photos in
 *   half-width pairs, captioned with the activity and the day, and the care notes. An open snag is a
 *   gap on the cover: "Still to fix: …";
 * - **the documents** by kind — permits, warranties, manuals, contracts, receipts — each by its name
 *   and file, the day it was added and what it is attached to; the files themselves are in the
 *   work's folder, never embedded (a PDF among them is listed, not printed);
 * - **who did what**: name, trade, contact, the stages they worked and their days on site;
 * - **the care notes for the whole work**, and any whose room or stage is gone, said so;
 * - **the record**: one sentence on the diary and the day the book was written. The chain's own
 *   verification block is the diary PDF's, and is not repeated here.
 *
 * A photo is an `image` block naming the hash of a file the work holds — the domain picks only
 * those — and the host embeds it. The host prints at most `REPORT_LIMITS.images`; past that, the
 * book says how many photos it left out, in words, rather than being refused whole.
 *
 * Pure: the selection, the work, an `I18n` and today in; a `ReportDocument` out. No clock, no host.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';
import type { TargetDescription } from '@/domain/documents';
import type {
  Handover,
  HandoverCareNote,
  HandoverGapRow,
  HandoverSection,
} from '@/domain/reports/handover';
import { HANDOVER_LABEL_KEYS } from '@/domain/reports/handover';
import type { WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { termsFor, type TermKey } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { finished, pieces, REPORT_LIMITS, tableRows } from './document';

type Term = (key: TermKey, options?: { capital?: boolean }) => string;

/** The words of one row: its parts joined the way the screen joins them, the empty ones left out. */
function row(...parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' — ');
}

/**
 * One thing the book still lacks, in a sentence: the same words on the Reports card (in the lens on
 * screen) and on the book's first page (in the owner's).
 */
export function handoverGapText(i18n: Pick<I18n, 't'>, term: Term, gap: HandoverGapRow): string {
  return i18n.t(gap.messageKey as MessageKey, {
    name: gap.title,
    note: term('careNote'),
    stage: term('stage'),
  });
}

/** How many things the book lacks, as its value says it: "4 gaps", "nothing missing". */
export function handoverGapsValue(i18n: Pick<I18n, 't' | 'tp'>, count: number): string {
  return count === 0
    ? i18n.t('reports.handover.gaps.none')
    : i18n.tp('reports.handover.gaps', count);
}

/** An attachment, in the Documents page's words: the row's name, "Entry #3", "The work". */
function targetText(i18n: Pick<I18n, 't'>, target: TargetDescription): string {
  return i18n.t(target.labelKey as MessageKey, { name: target.name ?? '', seq: target.seq ?? '' });
}

/** The images still allowed in the document, counted down as they are placed. */
interface ImageBudget {
  left: number;
  /** Photos the cap left out. */
  dropped: number;
}

function image(
  budget: ImageBudget,
  hash: string,
  caption: string,
  size: 'full' | 'half',
): ReportBlock | null {
  if (budget.left <= 0) {
    budget.dropped += 1;
    return null;
  }
  budget.left -= 1;
  return { type: 'image', hash, caption, size };
}

function careNoteBlocks(
  i18n: I18n,
  notes: readonly HandoverCareNote[],
  prefix: (note: HandoverCareNote) => string | null,
): ReportBlock[] {
  return notes.flatMap((note) => {
    const lead = prefix(note);
    const text =
      lead === null
        ? note.text
        : i18n.t('reports.handover.care.on', { name: lead, text: note.text });
    return pieces(text).map((piece): ReportBlock => ({ type: 'paragraph', text: piece }));
  });
}

function sectionBlocks(
  i18n: I18n,
  section: HandoverSection,
  budget: ImageBudget,
  hasSnags: boolean,
): ReportBlock[] {
  const { t, tp, day, number } = i18n;
  const blocks: ReportBlock[] = [];
  blocks.push({
    type: 'heading',
    level: 1,
    text: section.name ?? t(HANDOVER_LABEL_KEYS.other as MessageKey),
  });

  // Its stages, and where each one is.
  if (section.stages.length > 0) {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: section.stages
        .map((stage) =>
          row(
            stage.name,
            stage.state === 'closed' && stage.closedOn !== null
              ? t('stage.state.closed', { day: day(stage.closedOn) })
              : stage.state === 'started' && stage.startedOn !== null
                ? t('stage.state.started', { day: day(stage.startedOn) })
                : t('stage.state.planned'),
          ),
        )
        .join(' · '),
    });
  }

  // What was done, and when — from the diary.
  blocks.push({
    type: 'figure',
    label: t('reports.handover.done.label'),
    // The words agree with the whole, not the part: "0 de 22 concluídas", "1 of 22 finished".
    value: tp('reports.handover.done.value', section.activities, {
      done: number(section.done.length),
      all: number(section.activities),
    }),
    rows: section.done.map((done) =>
      row(
        [done.number, done.name].filter((part) => part !== null).join(' '),
        done.stageName,
        t('reports.handover.done.on', { day: day(done.finishedOn) }),
      ),
    ),
  });

  // The decisions made, with their answers.
  blocks.push({
    type: 'figure',
    label: t('reports.handover.decisions.label'),
    value: number(section.decisions.length),
    rows: section.decisions.map((decision) =>
      row(
        decision.name,
        decision.answer ?? t('reports.handover.decisions.noAnswer'),
        decision.stageName,
        t('decisions.status.made', { day: day(decision.madeOn) }),
      ),
    ),
  });

  // The hidden work, photographed before it was closed: every photo, full width.
  blocks.push({ type: 'heading', level: 2, text: t('reports.handover.hidden.title') });
  if (section.hiddenWork.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.hidden.none') });
  }
  for (const photo of section.hiddenWork) {
    const block = image(
      budget,
      photo.photoHash,
      t('reports.handover.hidden.caption', {
        check: photo.checkName,
        stage: photo.stageName,
        day: day(photo.day),
      }),
      'full',
    );
    if (block !== null) blocks.push(block);
  }

  // E4: the snags fixed here, each with the photo of the problem and of the fix, side by side.
  if (hasSnags) {
    blocks.push({ type: 'heading', level: 2, text: t('reports.handover.snags.title') });
    if (section.snagsFixed.length === 0) {
      blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.snags.none') });
    }
    for (const snag of section.snagsFixed) {
      const name = t('snags.row.title', { number: snag.number, title: snag.title });
      blocks.push({
        type: 'paragraph',
        text: row(
          name,
          snag.activityName ?? snag.stageName,
          snag.personName,
          t('reports.handover.snags.fixedOn', { day: day(snag.closedOn) }),
        ),
      });
      if (snag.before === null) {
        blocks.push({
          type: 'paragraph',
          tone: 'muted',
          text: t('reports.handover.snags.noBefore', { name }),
        });
      } else {
        const before = image(
          budget,
          snag.before.photoHash,
          t('reports.handover.snags.before', { name, day: day(snag.raisedOn) }),
          'half',
        );
        if (before !== null) blocks.push(before);
      }
      if (snag.after !== null) {
        const after = image(
          budget,
          snag.after.photoHash,
          t('reports.handover.snags.after', { name, day: day(snag.closedOn) }),
          'half',
        );
        if (after !== null) blocks.push(after);
      }
    }
  }

  // Other photos, from the diary: half width, two to a row.
  blocks.push({ type: 'heading', level: 2, text: t('reports.handover.photos.title') });
  if (section.photos.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.photos.none') });
  }
  for (const photo of section.photos) {
    const block = image(
      budget,
      photo.photoHash,
      t('reports.handover.photos.caption', {
        activity: photo.activityName,
        day: day(photo.day),
      }),
      'half',
    );
    if (block !== null) blocks.push(block);
  }
  if (section.photosNotShown > 0) {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: tp('reports.handover.photos.notShown', section.photosNotShown),
    });
  }

  // How to look after it.
  blocks.push({ type: 'heading', level: 2, text: t('reports.handover.care.title') });
  if (section.careNotes.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.care.none') });
  }
  blocks.push(
    ...careNoteBlocks(i18n, section.careNotes, (note) =>
      // The section's own notes need no name — its heading gave it; a stage's, in a room, say which.
      note.targetKind === 'stage' && section.kind !== 'stage' ? note.targetName : null,
    ),
  );
  return blocks;
}

/**
 * The handover book in `i18n`'s language and the owner's words. `today` is the day it is written,
 * said in its last sentence.
 */
export function composeHandover(
  book: Handover,
  snapshot: WorkSnapshot,
  i18n: I18n,
  today: string,
): ReportDocument {
  const { t, tp, day, number } = i18n;
  const term = termsFor(i18n.language, 'owner');
  const title = term('handoverBook', { capital: true });
  const budget: ImageBudget = { left: REPORT_LIMITS.images, dropped: 0 };
  const blocks: ReportBlock[] = [];

  // ── The cover ──
  // The host prints the title and the subtitle (the work) at the top of the first page.
  if (book.cover.inProgress) {
    blocks.push({ type: 'paragraph', tone: 'strong', text: t('reports.handover.inProgress') });
  }
  if (book.cover.place.trim() !== '') {
    blocks.push({ type: 'paragraph', tone: 'strong', text: book.cover.place });
  }
  blocks.push({
    type: 'paragraph',
    text: [
      t('reports.handover.cover.started', { day: day(book.cover.startDate) }),
      book.cover.finishedOn === null
        ? t('reports.handover.cover.notFinished')
        : t('reports.handover.cover.finished', { day: day(book.cover.finishedOn) }),
    ].join(' '),
  });
  if (book.cover.template !== null && book.cover.template.title !== null) {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: t('plan.fieldOf', {
        field: t('dashboard.calendar.template'),
        name:
          book.cover.template.version === null
            ? book.cover.template.title
            : t('dashboard.calendar.templateVersion', {
                title: book.cover.template.title,
                version: number(book.cover.template.version),
              }),
      }),
    });
  }
  blocks.push({
    type: 'paragraph',
    tone: 'muted',
    text: t(
      book.by === 'room' ? 'reports.handover.reading.byRoom' : 'reports.handover.reading.byStage',
      { room: term('room'), stage: term('stage') },
    ),
  });

  // What the book still lacks — printed with its zero, never dropped.
  blocks.push({
    type: 'figure',
    label: t(HANDOVER_LABEL_KEYS.gaps as MessageKey),
    value: handoverGapsValue(i18n, book.gaps.value),
    rows: book.gaps.rows.map((gap) => handoverGapText(i18n, term, gap)),
  });

  // The people, by trade.
  blocks.push({
    type: 'heading',
    level: 2,
    text: t('reports.handover.cover.people', { trade: term('trade') }),
  });
  if (book.cover.trades.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.people.none') });
  } else {
    blocks.push({
      type: 'table',
      columns: [
        { text: term('trade', { capital: true }), align: 'left', width: 0.35 },
        { text: t('reports.handover.people.names'), align: 'left', width: 0.65 },
      ],
      rows: tableRows(
        book.cover.trades.map((each) => [
          each.trade ?? t('reports.handover.people.noTrade'),
          each.people.map((person) => person.name).join(', '),
        ]),
      ),
    });
  }

  // ── Room by room, or stage by stage ──
  for (const section of book.sections) {
    blocks.push({ type: 'pageBreak' });
    blocks.push(...sectionBlocks(i18n, section, budget, snapshot.snags.length > 0));
  }
  if (book.sections.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.sections.none') });
  }
  if (budget.dropped > 0) {
    blocks.push({
      type: 'paragraph',
      tone: 'strong',
      text: tp('reports.handover.photos.overCap', budget.dropped, {
        max: number(REPORT_LIMITS.images),
      }),
    });
  }

  // ── The documents ──
  blocks.push({ type: 'pageBreak' });
  blocks.push({ type: 'heading', level: 1, text: t('nav.documents') });
  blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.documents.reading') });
  for (const group of book.documents) {
    blocks.push({
      type: 'figure',
      label: t(group.labelKey as MessageKey),
      value: number(group.documents.length),
      rows: group.documents.map((document) =>
        row(
          document.title === document.fileName
            ? document.title
            : t('reports.handover.documents.file', {
                title: document.title,
                file: document.fileName,
              }),
          t('reports.handover.documents.added', { day: day(document.addedOn) }),
          document.attachedTo.length === 0
            ? null
            : t('reports.handover.documents.attached', {
                targets: document.attachedTo.map((target) => targetText(i18n, target)).join(', '),
              }),
        ),
      ),
    });
  }

  // ── Who did what ──
  blocks.push({ type: 'heading', level: 1, text: t('reports.handover.people.title') });
  if (book.people.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.people.none') });
  } else {
    blocks.push({
      type: 'table',
      columns: [
        { text: term('person', { capital: true }), align: 'left', width: 0.22 },
        { text: term('trade', { capital: true }), align: 'left', width: 0.16 },
        { text: t('reports.handover.people.contact'), align: 'left', width: 0.24 },
        { text: t('reports.handover.people.stages'), align: 'left', width: 0.24 },
        { text: t('reports.handover.people.days'), align: 'right', width: 0.14 },
      ],
      rows: tableRows(
        book.people.map((person) => [
          person.name,
          person.trade ?? t('reports.handover.people.noTrade'),
          [person.phone, person.email]
            .filter((part): part is string => part !== null && part !== '')
            .join(' · '),
          person.stages.length === 0
            ? t('reports.handover.people.noStages')
            : person.stages.map((stage) => stage.name).join(', '),
          number(person.daysOnSite),
        ]),
      ),
    });
  }

  // ── Looking after the whole work ──
  blocks.push({ type: 'heading', level: 1, text: t('reports.handover.care.work') });
  if (book.careNotes.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.handover.care.none') });
  }
  blocks.push(
    ...careNoteBlocks(i18n, book.careNotes, (note) =>
      note.detached ? t('documents.target.detached') : null,
    ),
  );

  // ── The record ──
  blocks.push({ type: 'heading', level: 1, text: t('reports.handover.record.title') });
  blocks.push({
    type: 'paragraph',
    text:
      book.record.written === 0 || book.record.firstDay === null || book.record.lastDay === null
        ? t('reports.handover.record.empty')
        : tp('reports.handover.record.summary', book.record.written, {
            from: day(book.record.firstDay),
            to: day(book.record.lastDay),
          }),
  });
  blocks.push({
    type: 'paragraph',
    tone: 'muted',
    text: t('reports.handover.record.written', { day: day(today) }),
  });

  return finished({
    kind: 'handover',
    title,
    subtitle: snapshot.work.name,
    pageSize: 'a4',
    language: i18n.language,
    blocks,
  });
}
