import { Delete20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { LIMITS } from '@/data/commands';
import { useAddPerson, useRemovePerson, useRenamePerson, useUpdatePerson } from '@/data/queries';
import type { Person, WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Input } from '@/ui/Input';

import { AddForm } from './AddForm';
import { NameField } from './NameField';
import type { Outcome } from './outcome';

/**
 * The people on the work: a name each, not an account. Renamed in place; removed after a
 * question that says what follows — every activity they answered for is left with nobody, and
 * readiness drops by as much, which is the truth about a plan that has lost a person.
 */
export function PeopleCard({ snapshot, outcome }: { snapshot: WorkSnapshot; outcome: Outcome }) {
  const { t, tp } = useI18n();
  const term = useTerms();
  const add = useAddPerson();
  const rename = useRenamePerson();
  const remove = useRemovePerson();
  const [removal, setRemoval] = useState<Person | null>(null);

  const answersFor = (person: Person) =>
    snapshot.activities.filter((activity) => activity.responsibleId === person.id).length;

  return (
    <Card title={t('plan.people.title')} description={t('plan.people.description')}>
      {snapshot.people.length === 0 ? (
        <p className="mb-3 text-body text-fg-tertiary">{t('plan.people.empty')}</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1">
          {snapshot.people.map((person) => (
            <li key={person.id} data-person-id={person.id} className="flex items-start gap-2">
              <NameField
                key={person.name}
                value={person.name}
                label={t('plan.fieldOf', {
                  field: term('person', { capital: true }),
                  name: person.name,
                })}
                onCommit={(name) =>
                  rename.mutate(
                    { id: person.id, name },
                    { onSuccess: outcome.kept, onError: outcome.refused },
                  )
                }
              />
              <TradeField person={person} outcome={outcome} />
              <Button
                appearance="subtle"
                icon={<Delete20Regular />}
                data-testid="person-remove"
                onClick={() => setRemoval(person)}
              >
                {t('plan.remove')}
              </Button>
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
              outcome.kept();
              done();
            },
            onError: outcome.refused,
          })
        }
      />

      <ConfirmDialog
        open={removal !== null}
        title={removal === null ? '' : t('plan.confirm.removeTitle', { name: removal.name })}
        confirmLabel={t('plan.remove')}
        danger
        pending={remove.isPending}
        onCancel={() => setRemoval(null)}
        onConfirm={() => {
          if (removal === null) return;
          remove.mutate(removal.id, {
            onSuccess: () => {
              outcome.kept();
              setRemoval(null);
            },
            onError: (error) => {
              outcome.refused(error);
              setRemoval(null);
            },
          });
        }}
      >
        {removal === null
          ? null
          : answersFor(removal) === 0
            ? t('plan.confirm.personNone')
            : tp('plan.confirm.personBody', answersFor(removal))}
      </ConfirmDialog>
    </Card>
  );
}

/**
 * A person's trade — tiler, electrician — which money is grouped by (slice F6). Kept as it is
 * typed: a trade is a word, not a decision, and an empty one clears it.
 */
function TradeField({ person, outcome }: { person: Person; outcome: Outcome }) {
  const { t } = useI18n();
  const update = useUpdatePerson();
  const [trade, setTrade] = useState(person.trade ?? '');

  return (
    <Input
      data-testid="person-trade"
      className="w-48"
      aria-label={t('plan.person.trade', { name: person.name })}
      placeholder={t('plan.person.tradeHint')}
      maxLength={LIMITS.trade}
      value={trade}
      onChange={(event) => {
        const next = event.target.value;
        setTrade(next);
        update.mutate(
          { id: person.id, patch: { trade: next.trim() === '' ? null : next.trim() } },
          { onSuccess: outcome.kept, onError: outcome.refused },
        );
      }}
    />
  );
}
