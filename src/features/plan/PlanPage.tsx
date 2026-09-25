import { Add20Regular, Delete20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { LIMITS } from '@/data/commands';
import {
  useAddActivity,
  useAddPerson,
  useAddStage,
  useRemoveActivity,
  useRemoveStage,
} from '@/data/queries';
import { stagesInOrder, type Activity, type Stage, type WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

import { ActivityRow } from './ActivityRow';

/** What the confirmation dialog is about to remove. */
type Removal =
  | { kind: 'stage'; id: string; name: string; activities: number }
  | { kind: 'activity'; id: string; name: string };

/**
 * The plan: the stages in order, each with its activities, and the people who can answer for
 * them.
 *
 * What a person writes here is intent — a name, a duration in working days, a responsible. There
 * is deliberately nothing here that records how far along anything is: that is the diary's to
 * say (SPEC §2.6), and a plan that let it be typed would be a plan that could be rewritten in
 * silence. Every change is kept the moment it is made; the host answers with the whole plan, and
 * the screen shows that answer.
 */
export function PlanPage({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, tp, describeError } = useI18n();
  const removeStage = useRemoveStage();
  const removeActivity = useRemoveActivity();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const refused = (error: unknown) => setRefusal(describeError(error));
  const kept = () => setRefusal(null);

  const stages = stagesInOrder(snapshot);
  const activitiesOf = (stage: Stage): Activity[] =>
    snapshot.activities
      .filter((activity) => activity.stageId === stage.id)
      .sort((a, b) => a.position - b.position);

  const confirmRemoval = () => {
    if (removal === null) return;
    const options = {
      onSuccess: () => {
        kept();
        setRemoval(null);
      },
      onError: (error: unknown) => {
        refused(error);
        setRemoval(null);
      },
    };
    if (removal.kind === 'stage') removeStage.mutate(removal.id, options);
    else removeActivity.mutate(removal.id, options);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.plan')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('plan.lead')}</p>
      </header>

      {refusal !== null && (
        <InfoBar severity="danger" title={t('plan.refused')}>
          {refusal}
        </InfoBar>
      )}

      <PeopleCard snapshot={snapshot} onRefused={refused} onKept={kept} />

      <section aria-labelledby="plan-stages" className="flex flex-col gap-3">
        <h2 id="plan-stages" className="text-subtitle font-semibold text-fg">
          {t('plan.stages.title')}
        </h2>
        <AddStage onRefused={refused} onKept={kept} />

        {stages.length === 0 ? (
          <Card>
            <EmptyState
              title={t('plan.stages.emptyTitle')}
              description={t('plan.stages.emptyDescription')}
            />
          </Card>
        ) : (
          stages.map((stage) => {
            const activities = activitiesOf(stage);
            return (
              <div key={stage.id} data-stage-id={stage.id}>
                <Card
                  title={stage.name}
                  actions={
                    <Button
                      appearance="subtle"
                      icon={<Delete20Regular />}
                      onClick={() =>
                        setRemoval({
                          kind: 'stage',
                          id: stage.id,
                          name: stage.name,
                          activities: activities.length,
                        })
                      }
                    >
                      {t('plan.stage.remove')}
                    </Button>
                  }
                >
                  {activities.length === 0 ? (
                    <p className="text-body text-fg-tertiary">{t('plan.activities.empty')}</p>
                  ) : (
                    <table className="w-full border-collapse text-body">
                      <thead>
                        <tr className="text-left text-caption text-fg-tertiary">
                          <th scope="col" className="pb-1 font-semibold">
                            {t('plan.column.activity')}
                          </th>
                          <th scope="col" className="w-44 pb-1 pl-3 font-semibold">
                            {t('plan.column.duration')}
                          </th>
                          <th scope="col" className="w-56 pb-1 pl-3 font-semibold">
                            {t('plan.column.responsible')}
                          </th>
                          <th scope="col" className="pb-1 pl-3">
                            <span className="sr-only">{t('plan.column.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {activities.map((activity) => (
                          <ActivityRow
                            key={activity.id}
                            activity={activity}
                            people={snapshot.people}
                            onRefused={refused}
                            onKept={kept}
                            onRemove={() =>
                              setRemoval({
                                kind: 'activity',
                                id: activity.id,
                                name: activity.name,
                              })
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                  <AddActivity stage={stage} onRefused={refused} onKept={kept} />
                </Card>
              </div>
            );
          })
        )}
      </section>

      <ConfirmDialog
        open={removal !== null}
        title={
          removal === null
            ? ''
            : removal.kind === 'stage'
              ? t('plan.confirm.stageTitle', { name: removal.name })
              : t('plan.confirm.activityTitle', { name: removal.name })
        }
        confirmLabel={
          removal?.kind === 'stage' ? t('plan.stage.remove') : t('plan.confirm.activityConfirm')
        }
        danger
        pending={removeStage.isPending || removeActivity.isPending}
        onConfirm={confirmRemoval}
        onCancel={() => setRemoval(null)}
      >
        {removal === null
          ? null
          : removal.kind === 'activity'
            ? t('plan.confirm.activityBody')
            : removal.activities === 0
              ? t('plan.confirm.stageEmpty')
              : tp('plan.confirm.stageBody', removal.activities)}
      </ConfirmDialog>
    </div>
  );
}

/** A name and a button, submitted by the button or by Enter. */
function AddForm({
  label,
  inputTestId,
  buttonTestId,
  buttonLabel,
  icon,
  pending,
  onAdd,
}: {
  label: string;
  inputTestId: string;
  buttonTestId: string;
  buttonLabel: string;
  icon: ReactNode;
  pending: boolean;
  onAdd: (name: string, done: () => void) => void;
}) {
  const { t } = useI18n();
  const hint = useId();
  const [name, setName] = useState('');
  const [empty, setEmpty] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    onAdd(name.trim(), () => setName(''));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" noValidate>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          data-testid={inputTestId}
          aria-label={label}
          placeholder={label}
          aria-invalid={empty}
          aria-describedby={empty ? hint : undefined}
          value={name}
          maxLength={LIMITS.name}
          onChange={(event) => {
            setName(event.target.value);
            if (empty) setEmpty(false);
          }}
        />
        <Button type="submit" icon={icon} data-testid={buttonTestId} disabled={pending}>
          {buttonLabel}
        </Button>
      </div>
      {empty && (
        <span id={hint} className="text-caption text-fg-secondary">
          {t('plan.invalid.name')}
        </span>
      )}
    </form>
  );
}

function AddStage({ onRefused, onKept }: { onRefused: (e: unknown) => void; onKept: () => void }) {
  const { t } = useI18n();
  const add = useAddStage();
  return (
    <AddForm
      label={t('plan.stage.name')}
      inputTestId="stage-add-name"
      buttonTestId="stage-add"
      buttonLabel={t('plan.stage.add')}
      icon={<Add20Regular />}
      pending={add.isPending}
      onAdd={(name, done) =>
        add.mutate(name, {
          onSuccess: () => {
            onKept();
            done();
          },
          onError: onRefused,
        })
      }
    />
  );
}

function AddActivity({
  stage,
  onRefused,
  onKept,
}: {
  stage: Stage;
  onRefused: (e: unknown) => void;
  onKept: () => void;
}) {
  const { t } = useI18n();
  const add = useAddActivity();
  return (
    <div className="mt-3">
      <AddForm
        label={t('plan.activity.newName', { stage: stage.name })}
        inputTestId="activity-add-name"
        buttonTestId="activity-add"
        buttonLabel={t('plan.activity.add')}
        icon={<Add20Regular />}
        pending={add.isPending}
        onAdd={(name, done) =>
          add.mutate(
            { stageId: stage.id, name },
            {
              onSuccess: () => {
                onKept();
                done();
              },
              onError: onRefused,
            },
          )
        }
      />
    </div>
  );
}

function PeopleCard({
  snapshot,
  onRefused,
  onKept,
}: {
  snapshot: WorkSnapshot;
  onRefused: (e: unknown) => void;
  onKept: () => void;
}) {
  const { t } = useI18n();
  const add = useAddPerson();

  return (
    <Card title={t('plan.people.title')} description={t('plan.people.description')}>
      {snapshot.people.length === 0 ? (
        <p className="mb-3 text-body text-fg-tertiary">{t('plan.people.empty')}</p>
      ) : (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {snapshot.people.map((person) => (
            <li
              key={person.id}
              className="rounded-md border border-stroke-subtle bg-layer px-2 py-0.5 text-body text-fg"
            >
              {person.name}
            </li>
          ))}
        </ul>
      )}
      <AddForm
        label={t('plan.person.name')}
        inputTestId="person-add-name"
        buttonTestId="person-add"
        buttonLabel={t('plan.person.add')}
        icon={<PersonAdd20Regular />}
        pending={add.isPending}
        onAdd={(name, done) =>
          add.mutate(name, {
            onSuccess: () => {
              onKept();
              done();
            },
            onError: onRefused,
          })
        }
      />
    </Card>
  );
}
