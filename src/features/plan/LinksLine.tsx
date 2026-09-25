import { Dismiss16Regular, Link20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { LIMITS } from '@/data/commands';
import { errorKind } from '@/data/errors';
import { useAddDependency, useRemoveDependency } from '@/data/queries';
import {
  activitiesInOrder,
  stagesInOrder,
  type Dependency,
  type Endpoint,
  type WorkSnapshot,
} from '@/domain/plan';
import { cycleIfAdded, describeCycle } from '@/domain/schedule';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { useEndpointName } from './endpoints';
import type { Outcome } from './outcome';

/** One link as a chip — "after 1.1 Lay the floor tile · +2 d" — with the button that removes it. */
export function LinkChip({
  dependency,
  name,
  outcome,
}: {
  dependency: Dependency;
  name: (endpoint: Endpoint) => string;
  outcome: Outcome;
}) {
  const { t, number } = useI18n();
  const remove = useRemoveDependency();
  const what = name(dependency.blocker);
  return (
    <li
      data-link-id={dependency.id}
      className="flex items-center gap-1 rounded-md border border-stroke-subtle bg-layer py-0.5 pr-0.5 pl-2 text-caption text-fg"
    >
      <span>
        {dependency.lagDays > 0
          ? [
              t('plan.link.after', { what }),
              t('plan.link.lag', { lag: number(dependency.lagDays) }),
            ].join(' · ')
          : t('plan.link.after', { what })}
      </span>
      <button
        type="button"
        data-testid="link-remove"
        aria-label={t('plan.link.remove', { what })}
        title={t('plan.link.remove', { what })}
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(dependency.id, { onSuccess: outcome.kept, onError: outcome.refused })
        }
        className="grid size-6 place-items-center rounded-sm text-fg-secondary transition-colors duration-100 ease-easy hover:bg-card-hover"
      >
        <Dismiss16Regular aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * What an activity waits for: its links as chips, and the control that adds one.
 *
 * A link says "this starts after that finishes, plus so many working days of waiting". Either end
 * can be a whole stage, which stands for every activity in it. A link that would close a loop is
 * refused here, before the host is asked, with the loop named activity by activity (SPEC §6, a
 * mandatory negative case) — the host refuses the same link as a second guard, and its sentence is
 * shown in the same place if it ever gets that far.
 */
export function LinksLine({
  activityId,
  activityName,
  snapshot,
  numbers,
  outcome,
}: {
  activityId: string;
  activityName: string;
  snapshot: WorkSnapshot;
  numbers: ReadonlyMap<string, string | null>;
  outcome: Outcome;
}) {
  const { t, number, describeError } = useI18n();
  const term = useTerms();
  const add = useAddDependency();
  const hint = useId();
  const name = useEndpointName(snapshot, numbers);
  const [choice, setChoice] = useState('');
  const [lag, setLag] = useState('0');
  const [problem, setProblem] = useState<string | null>(null);

  const links = snapshot.dependencies.filter(
    (dependency) => dependency.blocked.kind === 'activity' && dependency.blocked.id === activityId,
  );
  const stages = stagesInOrder(snapshot);
  const others = activitiesInOrder(snapshot).filter((activity) => activity.id !== activityId);
  const names = new Map(snapshot.activities.map((activity) => [activity.id, activity.name]));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const [kind, id] = choice.split(':');
    if ((kind !== 'activity' && kind !== 'stage') || id === undefined || id === '') {
      setProblem(t('plan.link.chooseFirst'));
      return;
    }
    const lagDays = Number(lag === '' ? '0' : lag);
    if (!Number.isInteger(lagDays) || lagDays < 0 || lagDays > LIMITS.durationDays) {
      setProblem(t('plan.invalid.lag', { max: number(LIMITS.durationDays) }));
      return;
    }
    const blocker: Endpoint = { kind, id };
    const blocked: Endpoint = { kind: 'activity', id: activityId };
    const chain = cycleIfAdded(snapshot, blocker, blocked);
    if (chain !== null) {
      setProblem(
        t('plan.link.cycle', { chain: describeCycle(chain, (each) => names.get(each) ?? '') }),
      );
      return;
    }
    setProblem(null);
    add.mutate(
      { blocker, blocked, lagDays },
      {
        onSuccess: () => {
          outcome.kept();
          setChoice('');
          setLag('0');
        },
        onError: (error) => {
          if (errorKind(error) === 'dependency_cycle' || errorKind(error) === 'invalid_input') {
            setProblem(describeError(error));
          } else {
            outcome.refused(error);
          }
        },
      },
    );
  };

  return (
    <div data-testid="links" className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-2">
      <span aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-caption font-semibold text-fg-tertiary">{t('plan.links')}</span>
        {links.length === 0 ? (
          <span className="text-caption text-fg-tertiary">{t('plan.links.none')}</span>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {links.map((dependency) => (
              <LinkChip key={dependency.id} dependency={dependency} name={name} outcome={outcome} />
            ))}
          </ul>
        )}
        <form
          onSubmit={submit}
          noValidate
          className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2"
        >
          <Select
            data-testid="link-blocker"
            aria-label={t('plan.link.blockerOf', { name: activityName })}
            aria-describedby={problem !== null ? hint : undefined}
            value={choice}
            onChange={(event) => {
              setChoice(event.target.value);
              setProblem(null);
            }}
          >
            <option value="">{t('plan.link.choose')}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={`stage:${stage.id}`}>
                {name({ kind: 'stage', id: stage.id })}
              </option>
            ))}
            {others.map((activity) => (
              <option key={activity.id} value={`activity:${activity.id}`}>
                {name({ kind: 'activity', id: activity.id })}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={LIMITS.durationDays}
            step={1}
            data-testid="link-lag"
            aria-label={t('plan.link.lagOf', {
              lag: term('lag', { capital: true }),
              name: activityName,
            })}
            value={lag}
            onChange={(event) => setLag(event.target.value)}
          />
          <Button
            type="submit"
            icon={<Link20Regular />}
            data-testid="link-add"
            disabled={add.isPending}
          >
            {t('plan.link.add')}
          </Button>
        </form>
        {problem !== null && (
          <div id={hint} data-testid="link-problem">
            <InfoBar severity="caution" title={t('plan.link.refused')}>
              {problem}
            </InfoBar>
          </div>
        )}
      </div>
    </div>
  );
}
