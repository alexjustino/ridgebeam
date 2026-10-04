import { Add20Regular, Delete20Regular, Save20Regular } from '@fluentui/react-icons';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { LIMITS } from '@/data/commands';
import { useRaiseChange } from '@/data/queries';
import { breakdown } from '@/domain/arrangements';
import {
  CHANGE_LIMITS,
  changeImpact,
  type ChangeAskedBy,
  type ChangeEffect,
} from '@/domain/changes';
import { stagesInOrder, type WorkSnapshot } from '@/domain/plan';
import { toSignedCents } from '@/i18n/format';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import { changeNameCapital, effectText, problemsText } from './changeWords';
import { ImpactPanel } from './ImpactPanel';

const ASKED_BY: readonly ChangeAskedBy[] = ['owner', 'person', 'other'];
const KINDS = ['add', 'duration', 'remove'] as const;
type EffectKind = (typeof KINDS)[number];

/** One effect as it is being written: every field as typed, read into an effect when it is whole. */
interface EffectDraft {
  readonly key: number;
  readonly kind: EffectKind;
  readonly name: string;
  readonly days: string;
  readonly after: string;
  readonly activityId: string;
}

type Term = ReturnType<typeof useTerms>;

/**
 * The effect a row says, or what it still lacks, in sentences. A whole number of working days from 1
 * to the host's limit; a name for an added activity; the activity a duration or a removal is about.
 */
function readEffect(
  i18n: Pick<I18n, 't' | 'number'>,
  term: Term,
  draft: EffectDraft,
): { effect: ChangeEffect } | { lacks: string[] } {
  const days = draft.days.trim() === '' ? Number.NaN : Number(draft.days);
  const daysOk = Number.isInteger(days) && days >= 1 && days <= CHANGE_LIMITS.durationDays;
  const lacks: string[] = [];
  const badDays = i18n.t('changes.effect.invalid.days', {
    max: i18n.number(CHANGE_LIMITS.durationDays),
  });
  if (draft.kind === 'add') {
    if (draft.name.trim() === '') {
      lacks.push(i18n.t('changes.effect.invalid.name', { activity: term('activity') }));
    }
    if (!daysOk) lacks.push(badDays);
    if (lacks.length > 0) return { lacks };
    return {
      effect: {
        kind: 'add',
        name: draft.name.trim(),
        durationDays: days,
        after: draft.after === '' ? null : draft.after,
      },
    };
  }
  if (draft.activityId === '') {
    lacks.push(i18n.t('changes.effect.invalid.activity', { activity: term('activity') }));
  }
  if (draft.kind === 'duration' && !daysOk) lacks.push(badDays);
  if (lacks.length > 0) return { lacks };
  return {
    effect:
      draft.kind === 'duration'
        ? { kind: 'duration', activityId: draft.activityId, durationDays: days }
        : { kind: 'remove', activityId: draft.activityId },
  };
}

/**
 * Raising a change order (slice E1, decision 6): who asked — the owner, a person of the plan or
 * someone named — what changes, the stage it lands in, what it costs (negative when it saves money,
 * empty when it is not priced yet) and what it does to the plan: **Add an effect** puts a row in the
 * list, and each row says what it does — an activity added after another, a duration changed, an
 * activity removed — and is taken out with its own button.
 *
 * **The impact is shown before anything is saved** (DESIGN_SYSTEM §8, _a warning comes before the
 * act_): the panel under the effects is the domain's `changeImpact` of what is typed, recomputed at
 * every keystroke — "Finishes 3 working days later — on 14 November instead of 11 November; costs
 * $1,200.00 more." — with the activities it moves as the rows of its figure. A row not finished yet
 * says what it lacks and is not counted, and the panel says how many it left out (§2, _a view says
 * what it left out_). Nothing is written until **Raise the change**; the host keeps the record, which
 * is never edited afterwards.
 *
 * What the domain refuses — a closed stage, an activity named twice — is said in the panel, in its
 * sentences, and the change is not raised until it is fixed. What only the host knows (a duration
 * outside an activity's range, removing an activity that earns a payment) comes back as the host's
 * sentence under the button. A saving adds no cost line: the form says so when the cost is negative,
 * so the plan's own lines are lowered by hand in the same replanning.
 */
export function RaiseChangeForm({
  snapshot,
  onDone,
  onCancel,
}: {
  snapshot: WorkSnapshot;
  onDone: () => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t, tp, number, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const raise = useRaiseChange();
  const field = useId();
  const id = (name: string) => `${field}-${name}`;
  const nextKey = useRef(0);

  // A closed stage takes no change at all, not even one of money alone: only open ones are offered.
  const stages = stagesInOrder(snapshot).filter((stage) => stage.closedAt === null);
  const firstOpen = stages[0]?.id ?? '';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [askedBy, setAskedBy] = useState<ChangeAskedBy>('owner');
  const [personId, setPersonId] = useState('');
  const [otherName, setOtherName] = useState('');
  const [stageId, setStageId] = useState(firstOpen);
  const [cost, setCost] = useState('');
  const [drafts, setDrafts] = useState<readonly EffectDraft[]>([]);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const activities = useMemo(
    () =>
      breakdown(snapshot)
        .filter((row) => row.kind === 'activity')
        .map((row) => ({
          id: row.id,
          label: [row.number, row.name].filter((part) => part !== null).join(' '),
        })),
    [snapshot],
  );

  // The money as typed: empty is "not priced yet", anything else must be an amount, signed.
  const costCents = cost.trim() === '' ? null : toSignedCents(cost);
  const costInvalid = cost.trim() !== '' && costCents === null;

  const read = useMemo(
    () => drafts.map((draft) => readEffect(i18n, term, draft)),
    [drafts, i18n, term],
  );
  const effects = useMemo(
    () => read.flatMap((each) => ('effect' in each ? [each.effect] : [])),
    [read],
  );
  const unfinished = read.length - effects.length;
  const impact = useMemo(
    () => (stageId === '' ? null : changeImpact(snapshot, { stageId, effects, costCents })),
    [snapshot, stageId, effects, costCents],
  );

  const kindLabels: Record<EffectKind, string> = {
    add: t('changes.effect.kind.add', { activity: term('activity') }),
    duration: t('changes.effect.kind.duration', { duration: term('duration') }),
    remove: t('changes.effect.kind.remove', { activity: term('activity') }),
  };

  const edit = (key: number, patch: Partial<EffectDraft>) =>
    setDrafts((now) => now.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  const addRow = () => {
    nextKey.current += 1;
    const key = nextKey.current;
    setDrafts((now) => [
      ...now,
      { key, kind: 'add', name: '', days: '', after: '', activityId: '' },
    ]);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: string[] = [];
    if (title.trim() === '') found.push(t('changes.invalid.title'));
    if (askedBy === 'person' && personId === '') found.push(t('changes.invalid.person'));
    if (askedBy === 'other' && otherName.trim() === '') found.push(t('changes.invalid.otherName'));
    if (stageId === '') found.push(t('changes.invalid.stage', { stage: term('stage') }));
    if (costInvalid) found.push(t('changes.invalid.cost'));
    for (const each of read) if ('lacks' in each) found.push(...each.lacks);
    if (impact !== null && !impact.ok) found.push(...problemsText(i18n, term, impact.problems));
    setProblems([...new Set(found)]);
    if (found.length > 0) return;
    const trimmed = title.trim();
    raise.mutate(
      {
        raisedOn: today,
        title: trimmed,
        description: description.trim() === '' ? null : description.trim(),
        askedBy,
        askedByPersonId: askedBy === 'person' ? personId : null,
        askedByName: askedBy === 'other' ? otherName.trim() : null,
        stageId,
        costCents,
        effects,
      },
      {
        onSuccess: (next) => {
          setRefusal(null);
          // The host numbers the change: the one just raised is the highest.
          const raised = next.changeOrders.reduce<{ number: number; title: string } | null>(
            (latest, each) => (latest === null || each.number > latest.number ? each : latest),
            null,
          );
          announce(
            t('changes.raised', {
              name: changeNameCapital(i18n, term, raised ?? { number: 0, title: trimmed }),
            }),
          );
          onDone();
        },
        onError: (error) => setRefusal(describeError(error)),
      },
    );
  };

  const currency = snapshot.work.currency;

  return (
    <Card
      title={t('changes.form.title', { changeOrder: term('changeOrder') })}
      description={t('changes.form.lead')}
    >
      <form data-testid="change-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('changes.field.title')}
            </span>
            <Input
              data-testid="change-title"
              aria-required="true"
              maxLength={LIMITS.changeTitle}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={id('description')}
              className="text-caption font-semibold text-fg-secondary"
            >
              {t('changes.field.description')}
            </label>
            <TextArea
              id={id('description')}
              data-testid="change-description"
              maxLength={LIMITS.changeDescription}
              aria-describedby={id('description-hint')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <span id={id('description-hint')} className="text-caption text-fg-tertiary">
              {t('changes.field.description.hint', { max: number(LIMITS.changeDescription) })}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div data-testid="change-asked-by">
            <ChoiceGroup<ChangeAskedBy>
              label={t('changes.field.askedBy')}
              options={ASKED_BY}
              value={askedBy}
              onChange={setAskedBy}
              labels={{
                owner: t('changes.askedBy.owner'),
                person: t('changes.askedBy.person'),
                other: t('changes.askedBy.other'),
              }}
            />
          </div>
          {askedBy === 'person' &&
            (snapshot.people.length === 0 ? (
              <p className="text-body text-fg-secondary">{t('changes.field.person.none')}</p>
            ) : (
              <label className="flex max-w-md flex-col gap-1">
                <span className="text-caption font-semibold text-fg-secondary">
                  {t('changes.field.person')}
                </span>
                <Select
                  data-testid="change-person"
                  value={personId}
                  onChange={(event) => setPersonId(event.target.value)}
                >
                  <option value="">{t('changes.field.person.choose')}</option>
                  {snapshot.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          {askedBy === 'other' && (
            <label className="flex max-w-md flex-col gap-1">
              <span className="text-caption font-semibold text-fg-secondary">
                {t('changes.field.otherName')}
              </span>
              <Input
                data-testid="change-other-name"
                maxLength={LIMITS.changeAskedByName}
                value={otherName}
                onChange={(event) => setOtherName(event.target.value)}
              />
            </label>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id('stage')} className="text-caption font-semibold text-fg-secondary">
              {term('stage', { capital: true })}
            </label>
            <Select
              id={id('stage')}
              data-testid="change-stage"
              aria-describedby={id('stage-hint')}
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
            >
              <option value="">{t('changes.field.stage.choose', { stage: term('stage') })}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
            <span id={id('stage-hint')} className="text-caption text-fg-tertiary">
              {t('changes.field.stage.hint', { activity: term('activity'), stage: term('stage') })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id('cost')} className="text-caption font-semibold text-fg-secondary">
              {t('changes.field.cost', { currency })}
            </label>
            <Input
              id={id('cost')}
              type="number"
              inputMode="decimal"
              step={0.01}
              data-testid="change-cost"
              aria-invalid={costInvalid}
              aria-describedby={id('cost-hint')}
              placeholder={t('money.notPriced')}
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
            <span id={id('cost-hint')} className="text-caption text-fg-secondary">
              {costInvalid
                ? t('changes.invalid.cost')
                : costCents !== null && costCents < 0
                  ? t('changes.field.cost.negative')
                  : t('changes.field.cost.hint')}
            </span>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2 border-t border-stroke-subtle pt-3">
          <legend className="text-body font-semibold text-fg">{t('changes.effects')}</legend>
          {drafts.length === 0 ? (
            <p className="text-body text-fg-secondary">{t('changes.effects.none')}</p>
          ) : (
            <ul aria-label={t('changes.effects.list')} className="flex flex-col gap-3">
              {drafts.map((draft, index) => {
                const outcome = read[index];
                const whole = outcome !== undefined && 'effect' in outcome ? outcome.effect : null;
                const said =
                  whole === null
                    ? t('changes.effect.unfinished', { position: number(index + 1) })
                    : effectText(i18n, snapshot, whole);
                return (
                  <li
                    key={draft.key}
                    data-change-effect={draft.kind}
                    data-whole={whole !== null}
                    className="flex flex-col gap-1 rounded-md border border-stroke-subtle px-3 py-2"
                  >
                    <div className="flex items-end gap-2">
                      <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[12rem_minmax(0,1fr)_7rem]">
                        <label className="flex flex-col gap-1">
                          <span className="text-caption font-semibold text-fg-secondary">
                            {t('changes.effect.kind')}
                          </span>
                          <Select
                            data-testid="change-effect-kind"
                            value={draft.kind}
                            onChange={(event) =>
                              edit(draft.key, { kind: event.target.value as EffectKind })
                            }
                          >
                            {KINDS.map((each) => (
                              <option key={each} value={each}>
                                {kindLabels[each]}
                              </option>
                            ))}
                          </Select>
                        </label>
                        {draft.kind === 'add' ? (
                          <label className="flex flex-col gap-1">
                            <span className="text-caption font-semibold text-fg-secondary">
                              {t('changes.effect.name', { activity: term('activity') })}
                            </span>
                            <Input
                              data-testid="change-effect-name"
                              maxLength={LIMITS.changeEffectName}
                              value={draft.name}
                              onChange={(event) => edit(draft.key, { name: event.target.value })}
                            />
                          </label>
                        ) : (
                          <label className="flex flex-col gap-1">
                            <span className="text-caption font-semibold text-fg-secondary">
                              {term('activity', { capital: true })}
                            </span>
                            <Select
                              data-testid="change-effect-activity"
                              value={draft.activityId}
                              onChange={(event) =>
                                edit(draft.key, { activityId: event.target.value })
                              }
                            >
                              <option value="">
                                {t('changes.effect.activity.choose', {
                                  activity: term('activity'),
                                })}
                              </option>
                              {activities.map((activity) => (
                                <option key={activity.id} value={activity.id}>
                                  {activity.label}
                                </option>
                              ))}
                            </Select>
                          </label>
                        )}
                        {draft.kind !== 'remove' && (
                          <label className="flex flex-col gap-1">
                            <span className="text-caption font-semibold text-fg-secondary">
                              {t('changes.effect.days')}
                            </span>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={CHANGE_LIMITS.durationDays}
                              step={1}
                              data-testid="change-effect-days"
                              value={draft.days}
                              onChange={(event) => edit(draft.key, { days: event.target.value })}
                            />
                          </label>
                        )}
                        {draft.kind === 'add' && (
                          <label className="flex flex-col gap-1 md:col-start-2">
                            <span className="text-caption font-semibold text-fg-secondary">
                              {t('changes.effect.after')}
                            </span>
                            <Select
                              data-testid="change-effect-after"
                              value={draft.after}
                              onChange={(event) => edit(draft.key, { after: event.target.value })}
                            >
                              <option value="">{t('changes.effect.after.none')}</option>
                              {activities.map((activity) => (
                                <option key={activity.id} value={activity.id}>
                                  {activity.label}
                                </option>
                              ))}
                            </Select>
                          </label>
                        )}
                      </div>
                      <IconButton
                        data-testid="change-effect-remove"
                        icon={<Delete20Regular />}
                        label={t('changes.effect.remove', { what: said })}
                        onClick={() =>
                          setDrafts((now) => now.filter((each) => each.key !== draft.key))
                        }
                      />
                    </div>
                    <span className="text-caption text-fg-secondary">
                      {whole === null && outcome !== undefined && 'lacks' in outcome
                        ? outcome.lacks.join(' ')
                        : said}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <Button
              icon={<Add20Regular />}
              data-testid="change-effect-add"
              disabled={drafts.length >= CHANGE_LIMITS.effects}
              aria-describedby={drafts.length >= CHANGE_LIMITS.effects ? id('full') : undefined}
              onClick={addRow}
            >
              {t('changes.effect.add')}
            </Button>
            {drafts.length >= CHANGE_LIMITS.effects && (
              <p id={id('full')} className="mt-1 text-caption text-fg-secondary">
                {t('changes.problem.tooMany', { limit: number(CHANGE_LIMITS.effects) })}
              </p>
            )}
          </div>
        </fieldset>

        {impact !== null && (
          <div className="flex flex-col gap-1">
            <ImpactPanel
              result={impact}
              currency={currency}
              testId="change-impact"
              label={t('changes.impact.title')}
            />
            {unfinished > 0 && (
              <p data-testid="change-impact-unfinished" className="text-caption text-fg-secondary">
                {tp('changes.effects.unfinished', unfinished)}
              </p>
            )}
          </div>
        )}

        {problems.length > 0 && (
          <div data-testid="change-problem">
            <InfoBar severity="caution" title={t('changes.problem.title')}>
              <ul className="flex flex-col gap-0.5">
                {problems.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}
        {refusal !== null && (
          <div data-testid="change-refused">
            <InfoBar severity="danger" title={t('changes.refused')}>
              {refusal}
            </InfoBar>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            type="submit"
            appearance="accent"
            icon={<Save20Regular />}
            data-testid="change-save"
            disabled={raise.isPending}
          >
            {raise.isPending ? t('common.working') : t('changes.save')}
          </Button>
          <Button onClick={onCancel} disabled={raise.isPending}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
