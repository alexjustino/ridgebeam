import {
  ArrowLeft20Regular,
  ArrowUndo20Regular,
  BoxCheckmark20Regular,
  Cart20Regular,
  Checkmark20Regular,
  Delete20Regular,
  DocumentAdd20Regular,
  Dismiss20Regular,
  PersonAdd20Regular,
  Add20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useToday } from '@/app/today';
import type { MinutesDraft } from '@/data/commands';
import { useCloseMeeting, useDiary } from '@/data/queries';
import {
  MEETING_ACTION_STATE_KEYS,
  MEETING_AGENDA_KEYS,
  MEETING_ITEM_KIND_KEYS,
  MEETING_LIMITS,
  meetingAgenda,
  validateMinutes,
  type Agenda,
  type AgendaItem,
} from '@/domain/meetings';
import type { PurchaseEventKind, WorkSnapshot } from '@/domain/plan';
import { purchaseStory } from '@/domain/purchases';
import { schedule } from '@/domain/schedule';
import { MakeDecisionDialog } from '@/features/decisions/MakeDecisionDialog';
import { changeNameCapital } from '@/features/plan/changeWords';
import { CloseSnagDialog, type SnagToClose } from '@/features/plan/CloseSnagDialog';
import { DecideChangeDialog, type ChangeToDecide } from '@/features/plan/DecideChangeDialog';
import { PurchaseEventDialog, type PurchaseToRecord } from '@/features/plan/PurchaseEventDialog';
import { RaiseSnagForm } from '@/features/plan/RaiseSnagForm';
import { snagNameCapital, snagRowTitle } from '@/features/plan/snagWords';
import type { MessageKey } from '@/i18n/en';
import { termsFor } from '@/i18n/terms';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { DateField } from '@/ui/DateField';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import { agendaDetailText, agendaTitle, meetingProblemsText } from './meetingWords';

/** What recording a purchase's event in the meeting writes as the item's outcome (G2). */
const OUTCOME_KEYS = {
  ordered: 'meeting.outcome.ordered',
  delivered: 'meeting.outcome.delivered',
  cancelled: 'meeting.outcome.cancelled',
} as const satisfies Record<PurchaseEventKind, MessageKey>;

/** What is announced once it is recorded: the Purchases tab's own sentences. */
const DONE_KEYS = {
  ordered: 'purchases.done.ordered',
  delivered: 'purchases.done.delivered',
  cancelled: 'purchases.done.cancelled',
} as const satisfies Record<PurchaseEventKind, MessageKey>;

/** The choice in an action's "who" that means somebody not in the plan, named. */
const NAMED = '__named__';

/** An action being written in this meeting: only a draft until the meeting is closed. */
interface ActionDraft {
  readonly key: number;
  readonly text: string;
  /** `''` for nobody, a person's id, or `NAMED`. */
  readonly who: string;
  readonly name: string;
  readonly dueOn: string;
  readonly duePending: boolean;
}

/** What the meeting did about an item through the product's own command, in the record's words. */
type Outcomes = Readonly<Record<string, string>>;

/** At most `limit` characters (code points), for a title frozen from the record. */
function clipped(text: string, limit: number): string {
  const characters = [...text];
  return characters.length <= limit ? text : characters.slice(0, limit).join('');
}

/**
 * This week's meeting (slice G1, decisions 3 and 5): a full page reached from the dashboard's card,
 * holding the agenda **already written from the record** (`meetingAgenda`), frozen as it stood when
 * the meeting was opened — so an item acted on stays on the page with what was done, rather than
 * leaving it.
 *
 * On each item, the action the product already has, through its own dialog: **Make the decision…**
 * (the Decisions page's dialog), **Approve…** / **Decline…** (E1's, with its impact shown again),
 * **Fix…** / **Withdraw…** (E4's), and, for an action carried from an earlier meeting, **Done** or
 * **Drop**. What a command did is real at once — it goes to the record as anywhere else — and becomes
 * the item's outcome in the minutes, in the owner's words ("Decision made: White oak"). **Raise a
 * snag…** adds one from the meeting. Each item takes a note of what was said.
 *
 * Who was there is ticked from the plan's people, or typed; **Add an action** writes what, who and by
 * when; the notes take the rest. Nothing of this is written until **Close the meeting…**, whose
 * confirmation says what will be written — the domain's refusals (`validateMinutes`) said first, in
 * the page, before the host is asked. The draft lives here, in memory: the shell asks before leaving
 * drops it (`onDirty`).
 */
export function MeetingPage({
  snapshot,
  onLeave,
  onDirty,
  onClosed,
}: {
  snapshot: WorkSnapshot;
  /** Back to the dashboard: the shell asks first when the draft holds anything. */
  onLeave: () => void;
  /** Whether the draft holds anything the person would lose by leaving. */
  onDirty: (dirty: boolean) => void;
  /** The minutes are written. */
  onClosed: () => void;
}) {
  const i18n = useI18n();
  const { t, tp, day, number, describeError } = i18n;
  const term = useTerms();
  const owner = useMemo(() => termsFor(i18n.language, 'owner'), [i18n.language]);
  const today = useToday();
  const diary = useDiary(true);
  const close = useCloseMeeting();
  const id = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const focusNext = useRef<string | null>(null);
  const nextAction = useRef(1);
  const raiseButton = useRef<HTMLButtonElement>(null);

  // The agenda is the record's as it stood when the meeting was opened, and stays so: a decision
  // made here keeps its item, with what was done, instead of leaving the agenda.
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  if (agenda === null && diary.data !== undefined) {
    setAgenda(meetingAgenda(snapshot, schedule(snapshot), diary.data, today));
  }

  const [heldOn, setHeldOn] = useState(today);
  const [heldPending, setHeldPending] = useState(false);
  const [present, setPresent] = useState<readonly string[]>([]);
  const [named, setNamed] = useState<readonly string[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [outcomes, setOutcomes] = useState<Outcomes>({});
  const [closures, setClosures] = useState<Readonly<Record<string, 'done' | 'dropped'>>>({});
  const [raised, setRaised] = useState<readonly string[]>([]);
  const [raising, setRaising] = useState(false);
  const [actions, setActions] = useState<readonly ActionDraft[]>([]);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [making, setMaking] = useState<{ id: string; name: string; key: string } | null>(null);
  const [deciding, setDeciding] = useState<(ChangeToDecide & { key: string }) | null>(null);
  const [closingSnag, setClosingSnag] = useState<(SnagToClose & { key: string }) | null>(null);
  const [recording, setRecording] = useState<(PurchaseToRecord & { key: string }) | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const dirty =
    present.length > 0 ||
    named.length > 0 ||
    Object.values(notes).some((note) => note.trim() !== '') ||
    Object.keys(outcomes).length > 0 ||
    Object.keys(closures).length > 0 ||
    raised.length > 0 ||
    actions.length > 0 ||
    meetingNotes.trim() !== '' ||
    heldOn !== today;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // The page opens on its heading, as every screen does.
  useEffect(() => {
    title.current?.focus();
  }, []);

  // After an item's command, the focus goes to the item — its button is gone.
  useEffect(() => {
    if (focusNext.current === null) return;
    items.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [snapshot, outcomes, closures]);

  const register = (key: string) => (element: HTMLLIElement | null) => {
    if (element === null) items.current.delete(key);
    else items.current.set(key, element);
  };

  const done = (key: string, outcome: string, said: string) => {
    setOutcomes((now) => ({ ...now, [key]: outcome }));
    focusNext.current = key;
    announce(said);
  };

  const agendaItems = agenda?.sections.flatMap((section) => section.items) ?? [];

  /** The minutes, as they would be written now. */
  const draft = (): MinutesDraft => ({
    heldOn,
    notes: meetingNotes.trim() === '' ? null : meetingNotes.trim(),
    attendees: [
      ...snapshot.people
        .filter((person) => present.includes(person.id))
        .map((person) => ({ personId: person.id, name: null })),
      ...named.map((name) => ({ personId: null, name })),
    ],
    items: [
      ...agendaItems.map((item) => {
        const note = (notes[item.key] ?? '').trim();
        const closed = item.kind === 'action-carried' ? closures[item.refId ?? ''] : undefined;
        return {
          kind: item.kind,
          refId: item.refId,
          title: clipped(agendaTitle(i18n, item), MEETING_LIMITS.itemTitle),
          note: note === '' ? null : note,
          outcome:
            closed !== undefined
              ? t(MEETING_ACTION_STATE_KEYS[closed] as MessageKey)
              : (outcomes[item.key] ?? null),
        };
      }),
      ...raised.map((snagId) => {
        const snag = snapshot.snags.find((each) => each.id === snagId);
        return {
          kind: 'snag' as const,
          refId: snagId,
          title: clipped(snag?.title ?? snagId, MEETING_LIMITS.itemTitle),
          note: null,
          outcome: t('meeting.outcome.raised', { snag: owner('snag', { capital: true }) }),
        };
      }),
    ],
    actions: actions.map((action) => ({
      text: action.text.trim(),
      personId: action.who !== '' && action.who !== NAMED ? action.who : null,
      name: action.who === NAMED ? action.name.trim() : null,
      dueOn: action.dueOn === '' ? null : action.dueOn,
    })),
    closures: Object.entries(closures).map(([actionId, outcome]) => ({
      actionId,
      outcome,
      note: null,
    })),
  });

  const ask = () => {
    setRefusal(null);
    const minutes = draft();
    const found = [
      ...(heldPending ? [t('meeting.dayUnfinished')] : []),
      ...actions.flatMap((action, index) =>
        action.duePending ? [t('meeting.dueUnfinished', { position: number(index + 1) })] : [],
      ),
      ...meetingProblemsText(i18n, validateMinutes(snapshot, minutes, today)),
    ];
    setProblems(found);
    if (found.length === 0) setConfirming(true);
  };

  const write = () => {
    if (agenda === null) return;
    close.mutate(draft(), {
      onSuccess: () => {
        setConfirming(false);
        announce(
          t('meeting.closed', {
            minutes: term('meetingMinutes', { capital: true }),
            number: agenda.number,
          }),
        );
        onClosed();
      },
      onError: (error) => {
        setConfirming(false);
        setRefusal(describeError(error));
      },
    });
  };

  const addName = () => {
    const name = nameInput.trim();
    if (name === '') return;
    if (!named.some((each) => each.toLowerCase() === name.toLowerCase())) {
      setNamed((now) => [...now, name]);
    }
    setNameInput('');
  };

  const updateAction = (key: number, patch: Partial<ActionDraft>) =>
    setActions((now) => now.map((each) => (each.key === key ? { ...each, ...patch } : each)));

  const thingsDone = Object.keys(outcomes).length + Object.keys(closures).length + raised.length;
  const meetingNumber = agenda?.number ?? snapshot.meetings.length + 1;
  const hasStage = snapshot.stages.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 ref={title} tabIndex={-1} className="text-title font-semibold text-fg">
            {t('meeting.title')}
          </h1>
          <p data-testid="meeting-number" className="mt-1 text-subtitle text-fg">
            {t('meeting.subtitle', { number: meetingNumber, work: snapshot.work.name })}
          </p>
          <p className="mt-1 max-w-3xl text-body text-fg-secondary">
            {t('meeting.lead', { minutes: term('meetingMinutes') })}
          </p>
        </div>
        <Button
          icon={<ArrowLeft20Regular />}
          data-testid="meeting-leave"
          className="shrink-0"
          onClick={onLeave}
        >
          {t('meeting.leave')}
        </Button>
      </header>

      <Card title={t('meeting.attendees.title')} description={t('meeting.attendees.lead')}>
        <div className="flex flex-col gap-4">
          <div className="flex max-w-56 flex-col gap-1">
            <label htmlFor={`${id}-day`} className="text-caption font-semibold text-fg-secondary">
              {t('meeting.day')}
            </label>
            <DateField
              id={`${id}-day`}
              data-testid="meeting-day"
              max={today}
              aria-describedby={`${id}-day-hint`}
              value={heldOn}
              onChange={setHeldOn}
              onPendingChange={setHeldPending}
            />
            <span id={`${id}-day-hint`} className="text-caption text-fg-tertiary">
              {t('meeting.day.hint')}
            </span>
          </div>
          {snapshot.people.length === 0 ? (
            <p className="text-body text-fg-secondary">{t('meeting.attendees.none')}</p>
          ) : (
            <ul aria-label={t('meeting.attendees.title')} className="grid gap-2 sm:grid-cols-2">
              {snapshot.people.map((person) => (
                <li key={person.id} data-person-id={person.id}>
                  <label className="flex items-center gap-2 text-body text-fg">
                    <Checkbox
                      testId="meeting-attendee"
                      label={person.name}
                      checked={present.includes(person.id)}
                      onChange={(checked) =>
                        setPresent((now) =>
                          checked ? [...now, person.id] : now.filter((each) => each !== person.id),
                        )
                      }
                    />
                    <span>{person.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {named.length > 0 && (
            <ul aria-label={t('meeting.attendees.name')} className="grid gap-2 sm:grid-cols-2">
              {named.map((name) => (
                <li key={name} data-attendee-name={name}>
                  <label className="flex items-center gap-2 text-body text-fg">
                    <Checkbox
                      testId="meeting-attendee"
                      label={t('meeting.attendees.named', { name })}
                      checked
                      onChange={() => setNamed((now) => now.filter((each) => each !== name))}
                    />
                    <span>{t('meeting.attendees.named', { name })}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form
            noValidate
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              addName();
            }}
          >
            <label htmlFor={`${id}-name`} className="text-caption font-semibold text-fg-secondary">
              {t('meeting.attendees.name')}
            </label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                id={`${id}-name`}
                data-testid="meeting-attendee-name"
                maxLength={MEETING_LIMITS.name}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
              />
              <Button
                type="submit"
                icon={<PersonAdd20Regular />}
                data-testid="meeting-attendee-add"
              >
                {t('meeting.attendees.add')}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <section data-testid="meeting-agenda" aria-labelledby={`${id}-agenda`}>
        <Card>
          <h2 id={`${id}-agenda`} className="text-body-lg font-semibold text-fg">
            {t('meeting.agenda.title')}
          </h2>
          <p className="mt-0.5 text-caption text-fg-tertiary">{t('meeting.agenda.lead')}</p>
          {agenda !== null && agenda.since !== null && (
            <p className="mt-1 text-caption text-fg-tertiary">
              {t('meeting.agenda.since', { day: day(agenda.since) })}
            </p>
          )}
          {diary.isError && (
            <div className="mt-3">
              <InfoBar severity="danger" title={t('common.hostSilent')}>
                {describeError(diary.error)}
              </InfoBar>
            </div>
          )}
          {agenda === null ? (
            !diary.isError && (
              <p className="mt-3 text-body text-fg-tertiary">{t('reports.weekly.waiting')}</p>
            )
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {agenda.empty && agenda.messageKey !== null && (
                <p data-testid="meeting-agenda-empty" className="text-body text-fg">
                  {t(agenda.messageKey as MessageKey)}
                </p>
              )}
              {!agenda.placed && (
                <p className="text-caption text-fg-secondary">
                  {t(MEETING_AGENDA_KEYS.noSchedule)}
                </p>
              )}
              {agenda.sections.map((section) => (
                <section key={section.id} data-agenda-section={section.id}>
                  <h3 className="mb-2 text-body font-semibold text-fg">
                    {t(section.labelKey as MessageKey)}
                  </h3>
                  <ul
                    aria-label={t(section.labelKey as MessageKey)}
                    className="flex flex-col gap-3"
                  >
                    {section.items.map((item) => (
                      <AgendaLine
                        key={item.key}
                        ref={register(item.key)}
                        snapshot={snapshot}
                        item={item}
                        note={notes[item.key] ?? ''}
                        onNote={(note) => setNotes((now) => ({ ...now, [item.key]: note }))}
                        outcome={outcomes[item.key] ?? null}
                        closure={
                          item.kind === 'action-carried'
                            ? (closures[item.refId ?? ''] ?? null)
                            : null
                        }
                        onClosure={(outcome) => {
                          const actionId = item.refId ?? '';
                          setClosures((now) => {
                            const next = { ...now };
                            if (outcome === null) delete next[actionId];
                            else next[actionId] = outcome;
                            return next;
                          });
                          focusNext.current = item.key;
                        }}
                        onMake={(decision) =>
                          setMaking({ id: decision.id, name: decision.name, key: item.key })
                        }
                        onDecide={(decide) => setDeciding({ ...decide, key: item.key })}
                        onCloseSnag={(closing) => setClosingSnag({ ...closing, key: item.key })}
                        onRecord={(record) => setRecording({ ...record, key: item.key })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {raised.length > 0 && (
                <section data-agenda-section="raised">
                  <h3 className="mb-2 text-body font-semibold text-fg">
                    {t(MEETING_ITEM_KIND_KEYS.other as MessageKey)}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {raised.map((snagId) => {
                      const snag = snapshot.snags.find((each) => each.id === snagId);
                      return (
                        <li
                          key={snagId}
                          data-agenda-item={`raised:${snagId}`}
                          data-kind="snag"
                          className="rounded-md border border-stroke-subtle p-3"
                        >
                          <p className="text-body font-semibold text-fg">
                            {snag === undefined ? snagId : snagRowTitle(i18n, snag)}
                          </p>
                          <p data-testid="meeting-item-outcome" className="text-body text-fg">
                            {t('meeting.item.outcome', {
                              outcome: t('meeting.outcome.raised', {
                                snag: term('snag', { capital: true }),
                              }),
                            })}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-col items-start gap-1">
            {raising ? null : (
              <Button
                ref={raiseButton}
                icon={<DocumentAdd20Regular />}
                data-testid="meeting-snag-raise"
                disabled={!hasStage}
                aria-describedby={hasStage ? undefined : `${id}-no-stage`}
                onClick={() => setRaising(true)}
              >
                {t('snags.raise')}
              </Button>
            )}
            {!hasStage && (
              <p id={`${id}-no-stage`} className="text-body text-fg-secondary">
                {t('snags.raise.noStage', { snag: term('snag'), stage: term('stage') })}
              </p>
            )}
          </div>
        </Card>
      </section>

      {raising && (
        <RaiseSnagForm
          snapshot={snapshot}
          onDone={(snagId) => {
            setRaising(false);
            if (snagId !== null) setRaised((now) => [...now, snagId]);
            requestAnimationFrame(() => raiseButton.current?.focus());
          }}
          onCancel={() => {
            setRaising(false);
            requestAnimationFrame(() => raiseButton.current?.focus());
          }}
        />
      )}

      <Card
        title={t('meeting.actions.title')}
        description={t('meeting.actions.lead', { action: term('action') })}
      >
        <div className="flex flex-col gap-3">
          {actions.length === 0 ? (
            <p className="text-body text-fg-tertiary">{t('meeting.actions.none')}</p>
          ) : (
            <ol aria-label={t('meeting.actions.title')} className="flex flex-col gap-3">
              {actions.map((action, index) => (
                <ActionLine
                  key={action.key}
                  snapshot={snapshot}
                  action={action}
                  position={index + 1}
                  heldOn={heldOn}
                  onChange={(patch) => updateAction(action.key, patch)}
                  onRemove={() =>
                    setActions((now) => now.filter((each) => each.key !== action.key))
                  }
                />
              ))}
            </ol>
          )}
          <div>
            <Button
              icon={<Add20Regular />}
              data-testid="meeting-action-add"
              onClick={() => {
                const key = nextAction.current;
                nextAction.current += 1;
                setActions((now) => [
                  ...now,
                  { key, text: '', who: '', name: '', dueOn: '', duePending: false },
                ]);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(
                      `[data-new-action="${key}"] [data-testid="meeting-action-text"]`,
                    )
                    ?.focus(),
                );
              }}
            >
              {t('meeting.action.add', { action: term('action') })}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('meeting.notes')}>
        <div className="flex flex-col gap-1">
          <TextArea
            data-testid="meeting-notes"
            aria-label={t('meeting.notes')}
            aria-describedby={`${id}-notes-hint`}
            maxLength={MEETING_LIMITS.notes}
            value={meetingNotes}
            onChange={(event) => setMeetingNotes(event.target.value)}
          />
          <span id={`${id}-notes-hint`} className="text-caption text-fg-tertiary">
            {t('meeting.notes.hint', { max: number(MEETING_LIMITS.notes) })}
          </span>
        </div>
      </Card>

      {problems.length > 0 && (
        <div data-testid="meeting-problem">
          <InfoBar severity="caution" title={t('meeting.close.problem')}>
            <ul className="flex flex-col gap-0.5">
              {problems.map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
          </InfoBar>
        </div>
      )}
      {refusal !== null && (
        <div data-testid="meeting-refused">
          <InfoBar severity="danger" title={t('meeting.close.refused')}>
            {refusal}
          </InfoBar>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          appearance="accent"
          icon={<Checkmark20Regular />}
          data-testid="meeting-close"
          disabled={agenda === null || close.isPending}
          onClick={ask}
        >
          {t('meeting.close')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t('meeting.close.title', { number: meetingNumber })}
        confirmLabel={t('meeting.close.confirm')}
        confirmTestId="meeting-confirm"
        pending={close.isPending}
        onConfirm={write}
        onCancel={() => setConfirming(false)}
      >
        <ul data-testid="meeting-summary" className="flex flex-col gap-0.5">
          <li>{t('meeting.close.held', { day: heldOn === '' ? '' : day(heldOn) })}</li>
          <li>{tp('meeting.close.attendees', present.length + named.length)}</li>
          <li>{tp('meeting.close.items', agendaItems.length + raised.length)}</li>
          <li>{tp('meeting.close.done', thingsDone)}</li>
          <li>{tp('meeting.close.actions', actions.length)}</li>
          <li>{tp('meeting.close.closed', Object.keys(closures).length)}</li>
        </ul>
        <p className="mt-2">{t('meeting.close.body', { minutes: term('meetingMinutes') })}</p>
      </ConfirmDialog>

      <MakeDecisionDialog
        decision={making}
        onClose={() => setMaking(null)}
        onMade={(answer) => {
          if (making === null) return;
          const outcome =
            answer === null
              ? t('meeting.outcome.decisionNoAnswer')
              : t('meeting.outcome.decision', { answer });
          done(making.key, clipped(outcome, MEETING_LIMITS.itemOutcome), outcome);
          setMaking(null);
        }}
      />

      <DecideChangeDialog
        snapshot={snapshot}
        deciding={deciding}
        onClose={() => setDeciding(null)}
        onDecided={(decided) => {
          if (deciding === null) return;
          const changeOrder = owner('changeOrder', { capital: true });
          const outcome = t(
            decided.outcome === 'approved'
              ? 'meeting.outcome.approved'
              : 'meeting.outcome.declined',
            { changeOrder },
          );
          const name = changeNameCapital(i18n, term, decided.change);
          done(
            deciding.key,
            outcome,
            decided.outcome === 'approved'
              ? `${t('changes.approved.title', { name })} ${t('changes.approved.body')}`
              : t('changes.decided.declined', { name }),
          );
          setDeciding(null);
        }}
      />

      {recording !== null && (
        <PurchaseEventDialog
          snapshot={snapshot}
          recording={recording}
          onClose={() => setRecording(null)}
          onRecorded={(recorded) => {
            done(
              recording.key,
              t(OUTCOME_KEYS[recorded.kind], { day: day(recorded.day) }),
              t(DONE_KEYS[recorded.kind], { name: recorded.purchase.name }),
            );
            setRecording(null);
          }}
        />
      )}

      {closingSnag !== null && (
        <CloseSnagDialog
          snapshot={snapshot}
          closing={closingSnag}
          onClose={() => setClosingSnag(null)}
          onClosed={(closed) => {
            const snag = owner('snag', { capital: true });
            const name = snagNameCapital(i18n, term, closed.snag);
            done(
              closingSnag.key,
              t(
                closed.outcome === 'fixed' ? 'meeting.outcome.fixed' : 'meeting.outcome.withdrawn',
                {
                  snag,
                },
              ),
              t(closed.outcome === 'fixed' ? 'snags.fixed' : 'snags.withdrawn', { name }),
            );
            setClosingSnag(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * One item of the agenda: its title and what the record says of it, the marks — overdue, new since
 * the last meeting — in words and with an icon, never colour alone; the product's own action on it;
 * what was done, once done; and the note of what was said.
 */
function AgendaLine({
  ref,
  snapshot,
  item,
  note,
  onNote,
  outcome,
  closure,
  onClosure,
  onMake,
  onDecide,
  onCloseSnag,
  onRecord,
}: {
  ref: (element: HTMLLIElement | null) => void;
  snapshot: WorkSnapshot;
  item: AgendaItem;
  note: string;
  onNote: (note: string) => void;
  outcome: string | null;
  closure: 'done' | 'dropped' | null;
  onClosure: (outcome: 'done' | 'dropped' | null) => void;
  onMake: (decision: { id: string; name: string }) => void;
  onDecide: (decide: ChangeToDecide) => void;
  onCloseSnag: (closing: SnagToClose) => void;
  onRecord: (record: PurchaseToRecord) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const term = useTerms();
  const field = useId();
  const title = agendaTitle(i18n, item);

  const decision =
    item.kind === 'decision'
      ? snapshot.decisions.find((each) => each.id === item.refId)
      : undefined;
  const change =
    item.kind === 'change'
      ? snapshot.changeOrders.find((each) => each.id === item.refId)
      : undefined;
  const snag =
    item.kind === 'snag' ? snapshot.snags.find((each) => each.id === item.refId) : undefined;
  const purchase =
    item.section === 'purchases'
      ? snapshot.purchases.find((each) => each.id === item.refId)
      : undefined;
  const bought = purchase === undefined ? null : purchaseStory(purchase).state;

  const shownOutcome =
    closure !== null ? t(MEETING_ACTION_STATE_KEYS[closure] as MessageKey) : outcome;

  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-agenda-item={item.key}
      data-kind={item.kind}
      data-ref-id={item.refId ?? undefined}
      data-action-id={item.kind === 'action-carried' ? (item.refId ?? undefined) : undefined}
      data-overdue={item.overdue ? 'true' : undefined}
      data-new={item.newSinceLastMeeting ? 'true' : undefined}
      className="flex flex-col gap-2 rounded-md border border-stroke-subtle p-3"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-body font-semibold text-fg">{title}</p>
        {(item.overdue || item.newSinceLastMeeting) && (
          <p className="flex flex-wrap items-center gap-x-3 text-caption">
            {item.overdue && (
              <span
                data-testid="meeting-item-overdue"
                className="inline-flex items-center gap-1 text-fg"
              >
                <Warning16Regular aria-hidden="true" className="text-caution" />
                {t(MEETING_AGENDA_KEYS.overdue)}
              </span>
            )}
            {item.newSinceLastMeeting && (
              <span data-testid="meeting-item-new" className="text-fg-secondary">
                {t(MEETING_AGENDA_KEYS.newSince)}
              </span>
            )}
          </p>
        )}
        <p className="text-body text-fg-secondary">
          {agendaDetailText(i18n, term, snapshot, item)}
        </p>
      </div>

      {shownOutcome !== null && (
        <p data-testid="meeting-item-outcome" className="text-body text-fg">
          {t('meeting.item.outcome', { outcome: shownOutcome })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex">
        {item.kind === 'action-carried' &&
          (closure === null ? (
            <>
              <Button
                icon={<Checkmark20Regular />}
                data-testid="action-done"
                onClick={() => onClosure('done')}
              >
                {t('meeting.action.done')}
              </Button>
              <Button
                icon={<Dismiss20Regular />}
                data-testid="action-drop"
                onClick={() => onClosure('dropped')}
              >
                {t('meeting.action.drop')}
              </Button>
            </>
          ) : (
            <Button
              icon={<ArrowUndo20Regular />}
              data-testid="action-reopen"
              onClick={() => onClosure(null)}
            >
              {t('meeting.action.reopen')}
            </Button>
          ))}
        {outcome === null && decision !== undefined && decision.madeAt === null && (
          <Button
            data-testid="meeting-item-act"
            data-act="make"
            onClick={() => onMake({ id: decision.id, name: decision.name })}
          >
            {t('meeting.item.make')}
          </Button>
        )}
        {outcome === null && change !== undefined && change.decision === null && (
          <>
            <Button
              data-testid="meeting-item-act"
              data-act="approve"
              onClick={() => onDecide({ change, outcome: 'approved' })}
            >
              {t('changes.approve')}
            </Button>
            <Button
              data-testid="meeting-item-act"
              data-act="decline"
              onClick={() => onDecide({ change, outcome: 'declined' })}
            >
              {t('changes.decline')}
            </Button>
          </>
        )}
        {outcome === null && snag !== undefined && snag.closure === null && (
          <>
            <Button
              data-testid="meeting-item-act"
              data-act="fix"
              onClick={() => onCloseSnag({ snag, outcome: 'fixed' })}
            >
              {t('snags.fix')}
            </Button>
            <Button
              data-testid="meeting-item-act"
              data-act="withdraw"
              onClick={() => onCloseSnag({ snag, outcome: 'withdrawn' })}
            >
              {t('snags.withdraw')}
            </Button>
          </>
        )}
        {outcome === null && purchase !== undefined && bought === 'to-order' && (
          <Button
            icon={<Cart20Regular />}
            data-testid="meeting-item-act"
            data-act="ordered"
            onClick={() => onRecord({ purchase, kind: 'ordered' })}
          >
            {t('purchases.ordered')}
          </Button>
        )}
        {outcome === null && purchase !== undefined && bought === 'ordered' && (
          <>
            <Button
              icon={<BoxCheckmark20Regular />}
              data-testid="meeting-item-act"
              data-act="delivered"
              onClick={() => onRecord({ purchase, kind: 'delivered' })}
            >
              {t('purchases.delivered')}
            </Button>
            <Button
              icon={<ArrowUndo20Regular />}
              data-testid="meeting-item-act"
              data-act="cancelled"
              onClick={() => onRecord({ purchase, kind: 'cancelled' })}
            >
              {t('purchases.cancel')}
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
          {t('meeting.item.note')}
        </label>
        <TextArea
          id={field}
          data-testid="meeting-item-note"
          rows={2}
          maxLength={MEETING_LIMITS.itemNote}
          aria-label={t('meeting.item.note.for', { title })}
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
    </li>
  );
}

/** One action being written: what, who, by when — and, being a draft, a way to take it out. */
function ActionLine({
  snapshot,
  action,
  position,
  heldOn,
  onChange,
  onRemove,
}: {
  snapshot: WorkSnapshot;
  action: ActionDraft;
  position: number;
  heldOn: string;
  onChange: (patch: Partial<ActionDraft>) => void;
  onRemove: () => void;
}) {
  const { t, number } = useI18n();
  const field = useId();
  const id = (name: string) => `${field}-${name}`;

  return (
    <li
      data-new-action={action.key}
      className="grid gap-3 rounded-md border border-stroke-subtle p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id('text')} className="text-caption font-semibold text-fg-secondary">
          {t('meeting.action.text')}
        </label>
        <Input
          id={id('text')}
          data-testid="meeting-action-text"
          aria-required="true"
          maxLength={MEETING_LIMITS.actionText}
          value={action.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id('who')} className="text-caption font-semibold text-fg-secondary">
          {t('meeting.action.person')}
        </label>
        <Select
          id={id('who')}
          data-testid="meeting-action-person"
          value={action.who}
          onChange={(event) => onChange({ who: event.target.value })}
        >
          <option value="">{t('meeting.action.person.nobody')}</option>
          {snapshot.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value={NAMED}>{t('meeting.action.person.named')}</option>
        </Select>
        {action.who === NAMED && (
          <Input
            data-testid="meeting-action-name"
            aria-label={t('meeting.action.name')}
            placeholder={t('meeting.action.name')}
            maxLength={MEETING_LIMITS.name}
            value={action.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id('due')} className="text-caption font-semibold text-fg-secondary">
          {t('meeting.action.due')}
        </label>
        <DateField
          id={id('due')}
          data-testid="meeting-action-due"
          min={heldOn === '' ? undefined : heldOn}
          hint="hidden"
          value={action.dueOn}
          onChange={(dueOn) => onChange({ dueOn })}
          // The field says whether its text is a day yet on every render it gets a new callback;
          // only a change is passed on, or the draft would be rewritten on every render.
          onPendingChange={(duePending) => {
            if (duePending !== action.duePending) onChange({ duePending });
          }}
        />
      </div>
      <IconButton
        data-testid="meeting-action-remove"
        label={t('meeting.action.remove', { position: number(position) })}
        icon={<Delete20Regular />}
        onClick={onRemove}
      />
    </li>
  );
}
