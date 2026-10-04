import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  Delete20Regular,
  Open20Regular,
} from '@fluentui/react-icons';
import { useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';

import { LIMITS, type CareNoteTarget } from '@/data/commands';
import { useAddCareNote, useRemoveCareNote, useUpdateCareNote } from '@/data/queries';
import { checksAt, GATES, latestAnswers } from '@/domain/checks';
import {
  careNotesOf,
  roomsInOrder,
  stagesInOrder,
  type CareNote,
  type Check,
  type CheckAnswer,
  type Stage,
  type WorkSnapshot,
} from '@/domain/plan';
import { PhotoThumb } from '@/features/diary/PhotoThumb';
import { shortened } from '@/features/reports/compose/document';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { TextArea } from '@/ui/TextArea';

import { careTargetKey } from './careNotes';
import { chordDirection, useMover } from './moves';
import type { Outcome } from './outcome';

/** How much of a note an announcement or a button's name repeats. */
const NOTE_IN_A_NAME = 48;

/**
 * What the owner keeps when the work ends (D3, decision 7), on the Plan's **Handover** tab.
 *
 * **Care notes** — "Reseal the shower grout once a year", "The stopcock is under the sink" — on the
 * whole work, on each room and on each stage, in order. They are not the plan: approval does not
 * lock them and a closed stage does not either, so they are written, edited in place, moved and
 * removed here at any time; the host removes a room's or a stage's notes with it. Each target is a
 * block (`data-care-target="room:<id>"`) holding its notes (`data-care-note-id`) and its own add
 * field, so a note is always written where it will be printed.
 *
 * **Hidden work** — every check that needs a photo of the work before it is closed, with its latest
 * answer and its photo — each leading to its item on the Gates tab, where it is answered. This tab
 * answers nothing: one place answers checks (DESIGN_SYSTEM §8).
 */
export function HandoverTab({
  snapshot,
  onGates,
}: {
  snapshot: WorkSnapshot;
  /** Open the Gates tab on this check's item. */
  onGates: (checkId: string) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const rooms = roomsInOrder(snapshot);
  const stages = stagesInOrder(snapshot);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-body text-fg-secondary">
        {t('handover.lead', { book: term('handoverBook') })}
      </p>

      <Card title={t('handover.work.title')} description={t('handover.work.description')}>
        <CareBlock
          snapshot={snapshot}
          target={{ targetKind: 'work', targetId: snapshot.work.workId }}
          name={snapshot.work.name}
          heading={null}
        />
      </Card>

      <Card
        title={t('handover.rooms.title', { room: term('room') })}
        description={t('handover.rooms.description')}
      >
        {rooms.length === 0 ? (
          <p className="text-body text-fg-tertiary">
            {t('handover.rooms.none', { room: term('room') })}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-stroke-subtle">
            {rooms.map((room) => (
              <CareBlock
                key={room.id}
                snapshot={snapshot}
                target={{ targetKind: 'room', targetId: room.id }}
                name={room.name}
                heading={room.name}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title={t('handover.stages.title', { stage: term('stage') })}
        description={t('handover.stages.description')}
      >
        {stages.length === 0 ? (
          <p className="text-body text-fg-tertiary">
            {t('handover.stages.none', { stage: term('stage') })}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-stroke-subtle">
            {stages.map((stage) => (
              <CareBlock
                key={stage.id}
                snapshot={snapshot}
                target={{ targetKind: 'stage', targetId: stage.id }}
                name={stage.name}
                heading={stage.name}
              />
            ))}
          </div>
        )}
      </Card>

      <HiddenWorkCard snapshot={snapshot} onGates={onGates} />
    </div>
  );
}

/**
 * One target's care notes: its heading, its notes in order, and the field that adds one. A refusal
 * of anything done in the block is said in the block, under its notes.
 */
function CareBlock({
  snapshot,
  target,
  name,
  heading,
}: {
  snapshot: WorkSnapshot;
  target: CareNoteTarget;
  /** What the notes are about, for the names of the controls. */
  name: string;
  /** The block's heading, or `null` when the card's own heading already names it. */
  heading: string | null;
}) {
  const { t, describeError } = useI18n();
  const term = useTerms();
  const headingId = useId();
  const block = useRef<HTMLElement>(null);
  const addField = useRef<HTMLTextAreaElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const outcome: Outcome = useMemo(
    () => ({
      refused: (error: unknown) => setRefusal(describeError(error)),
      kept: () => setRefusal(null),
    }),
    [describeError],
  );
  const { go } = useMover(outcome);
  const notes = careNotesOf(snapshot, target.targetKind, target.targetId);
  const ids = notes.map((note) => note.id);

  /**
   * A note's Remove takes its own row away, so the focus is put where the person was going: the
   * note that took its place, else the one before it, else the field that adds one.
   */
  const removed = (index: number) => {
    const next = ids[index + 1] ?? ids[index - 1] ?? null;
    window.requestAnimationFrame(() => {
      const field =
        next === null
          ? addField.current
          : block.current?.querySelector<HTMLTextAreaElement>(
              `[data-care-note-id="${next}"] textarea`,
            );
      field?.focus();
    });
  };

  return (
    <section
      ref={block}
      data-care-target={careTargetKey(target.targetKind, target.targetId)}
      aria-labelledby={heading === null ? undefined : headingId}
      aria-label={
        heading === null
          ? t('plan.fieldOf', { field: term('careNote', { capital: true }), name })
          : undefined
      }
      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
    >
      {heading !== null && (
        <h3 id={headingId} className="text-body font-semibold text-fg">
          {heading}
        </h3>
      )}
      {notes.length === 0 ? (
        <p className="text-caption text-fg-tertiary">{t('handover.care.none')}</p>
      ) : (
        <ol
          aria-label={t('plan.fieldOf', { field: term('careNote', { capital: true }), name })}
          className="flex flex-col gap-2"
        >
          {notes.map((note, index) => (
            <CareNoteLine
              key={note.id}
              note={note}
              name={name}
              position={index + 1}
              outcome={outcome}
              onMove={(direction) =>
                go(
                  'careNote',
                  note.id,
                  direction,
                  ids,
                  shortened(note.text, NOTE_IN_A_NAME),
                  outcome,
                )
              }
              onRemoved={() => removed(index)}
            />
          ))}
        </ol>
      )}
      <AddCareNote target={target} name={name} outcome={outcome} field={addField} />
      {refusal !== null && (
        <div data-testid="care-note-problem">
          <InfoBar severity="danger" title={t('plan.refused')}>
            {refusal}
          </InfoBar>
        </div>
      )}
    </section>
  );
}

/**
 * One note, edited in place: kept when the field is left — or on Ctrl+Enter — put back by Escape,
 * and a field emptied is not kept: it says that Remove is how a note goes. A refusal keeps what was
 * typed so it can be corrected (DESIGN_SYSTEM §10).
 */
function CareNoteLine({
  note,
  name,
  position,
  outcome,
  onMove,
  onRemoved,
}: {
  note: CareNote;
  name: string;
  position: number;
  outcome: Outcome;
  onMove: (direction: 'up' | 'down') => void;
  onRemoved: () => void;
}) {
  const { t } = useI18n();
  const update = useUpdateCareNote();
  const remove = useRemoveCareNote();
  const hint = useId();
  const [text, setText] = useState(note.text);
  const [empty, setEmpty] = useState(false);
  const short = shortened(note.text, NOTE_IN_A_NAME);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    if (trimmed === note.text) return;
    update.mutate(
      { id: note.id, text: trimmed },
      { onSuccess: outcome.kept, onError: outcome.refused },
    );
  };

  return (
    <li
      data-care-note-id={note.id}
      className="flex items-start gap-1"
      onKeyDown={(event) => {
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      <span className="w-6 shrink-0 pt-2 text-right text-caption text-fg-tertiary tabular-nums">
        {position}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <TextArea
          data-testid="care-note-text"
          aria-label={t('handover.care.field', { position, name })}
          aria-invalid={empty}
          aria-describedby={empty ? hint : undefined}
          maxLength={LIMITS.careNote}
          rows={2}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (empty) setEmpty(false);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              setText(note.text);
              setEmpty(false);
            }
          }}
        />
        {empty && (
          <span id={hint} className="mt-1 text-caption text-fg-secondary">
            {t('handover.care.emptied')}
          </span>
        )}
      </span>
      <IconButton
        data-testid="care-note-up"
        icon={<ArrowUp20Regular />}
        label={t('plan.move.up', { name: short })}
        onClick={() => onMove('up')}
      />
      <IconButton
        data-testid="care-note-down"
        icon={<ArrowDown20Regular />}
        label={t('plan.move.down', { name: short })}
        onClick={() => onMove('down')}
      />
      <Button
        appearance="subtle"
        icon={<Delete20Regular />}
        data-testid="care-note-remove"
        aria-label={t('plan.removeNamed', { name: short })}
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(note.id, {
            onSuccess: () => {
              outcome.kept();
              announce(t('handover.care.removed', { name: short }));
              onRemoved();
            },
            onError: outcome.refused,
          })
        }
      >
        {t('plan.remove')}
      </Button>
    </li>
  );
}

function AddCareNote({
  target,
  name,
  outcome,
  field,
}: {
  target: CareNoteTarget;
  name: string;
  outcome: Outcome;
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const add = useAddCareNote();
  const hint = useId();
  const [text, setText] = useState('');
  const [empty, setEmpty] = useState(false);
  const label = t('plan.toAddIn', { what: term('careNote', { capital: true }), where: name });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === '') {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    add.mutate(
      { target, text: text.trim() },
      {
        onSuccess: () => {
          outcome.kept();
          setText('');
          announce(t('handover.care.added', { name }));
        },
        onError: outcome.refused,
      },
    );
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-1">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <TextArea
          ref={field}
          data-testid="care-note-add-text"
          aria-label={label}
          placeholder={t('handover.care.placeholder')}
          aria-invalid={empty}
          aria-describedby={empty ? hint : undefined}
          maxLength={LIMITS.careNote}
          rows={2}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (empty) setEmpty(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button
          type="submit"
          icon={<Add20Regular />}
          data-testid="care-note-add"
          className="justify-self-start"
          aria-label={t('plan.fieldOf', { field: t('plan.add', { what: term('careNote') }), name })}
          disabled={add.isPending}
        >
          {t('plan.add', { what: term('careNote') })}
        </Button>
      </div>
      {empty && (
        <span id={hint} className="text-caption text-fg-secondary">
          {t('handover.care.empty')}
        </span>
      )}
    </form>
  );
}

/** One check that needs its photo, with where it is and its latest answer. */
interface HiddenRow {
  readonly check: Check;
  readonly stage: Stage;
  readonly latest: CheckAnswer | null;
}

/**
 * Every check of the work that needs a photo of the work before it is closed, in the plan's order —
 * stage, then gate, then position — with its latest answer and its photo. Each row leads to its
 * item on the Gates tab; nothing is answered here.
 */
function HiddenWorkCard({
  snapshot,
  onGates,
}: {
  snapshot: WorkSnapshot;
  onGates: (checkId: string) => void;
}) {
  const { t, day } = useI18n();
  const latest = latestAnswers(snapshot.checkAnswers);
  const rows: HiddenRow[] = stagesInOrder(snapshot).flatMap((stage) =>
    GATES.flatMap((gate) =>
      checksAt(snapshot.checks, stage.id, gate)
        .filter((check) => check.needsPhoto)
        .map((check) => ({ check, stage, latest: latest.get(check.id) ?? null })),
    ),
  );

  const stateText = (row: HiddenRow): string => {
    const answer = row.latest;
    if (answer === null) return t('gates.unanswered');
    const when = { author: answer.authorName, day: day(answer.answeredAt.slice(0, 10)) };
    if (answer.answer === 'na')
      return t('gates.latest.na', { ...when, reason: answer.reason ?? '' });
    if (answer.answer === 'no') return t('gates.latest.no', when);
    return answer.photoHash === null
      ? t('handover.hidden.yesWithout', when)
      : t('handover.hidden.yesPhoto', when);
  };

  return (
    <Card title={t('handover.hidden.title')} description={t('handover.hidden.description')}>
      {rows.length === 0 ? (
        <p data-testid="hidden-work-none" className="text-body text-fg-tertiary">
          {t('handover.hidden.none')}
        </p>
      ) : (
        <ol data-testid="hidden-work" className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.check.id}
              data-hidden-check-id={row.check.id}
              data-state={
                row.latest === null
                  ? 'unanswered'
                  : row.latest.answer === 'yes' && row.latest.photoHash === null
                    ? 'yes-without-photo'
                    : row.latest.answer
              }
              className="flex items-start gap-3 border-t border-stroke-subtle py-2 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body text-fg">{row.check.name}</span>
                <span className="block text-caption text-fg-secondary">{row.stage.name}</span>
                <span data-testid="hidden-work-state" className="block text-caption text-fg">
                  {stateText(row)}
                </span>
              </span>
              {row.latest !== null && row.latest.photoHash !== null && (
                <PhotoThumb
                  size="sm"
                  day={row.latest.answeredAt.slice(0, 10)}
                  photo={{
                    fileHash: row.latest.photoHash,
                    fileName: row.check.name,
                    bytes: 0,
                    width: 0,
                    height: 0,
                    thumbnail: true,
                  }}
                />
              )}
              <Button
                appearance="subtle"
                icon={<Open20Regular />}
                data-testid="hidden-work-open"
                aria-label={t('handover.hidden.openNamed', { name: row.check.name })}
                onClick={() => onGates(row.check.id)}
              >
                {t('handover.hidden.open')}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
