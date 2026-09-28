import { Delete20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { LIMITS } from '@/data/commands';
import {
  useAddPerson,
  useRemovePerson,
  useRenamePerson,
  useSetPersonStages,
  useUpdatePerson,
} from '@/data/queries';
import { stagesInOrder, type Person, type WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
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
      <p className="mb-2 text-caption text-fg-tertiary">{t('plan.person.contactNote')}</p>
      {snapshot.people.length === 0 ? (
        <p className="mb-3 text-body text-fg-tertiary">{t('plan.people.empty')}</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1">
          {snapshot.people.map((person) => (
            <li
              key={person.id}
              data-person-id={person.id}
              className="flex flex-col gap-2 border-t border-stroke-subtle pt-2 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start gap-2">
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
                <ContactField person={person} field="trade" outcome={outcome} />
                <Button
                  appearance="subtle"
                  icon={<Delete20Regular />}
                  data-testid="person-remove"
                  onClick={() => setRemoval(person)}
                >
                  {t('plan.remove')}
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <ContactField person={person} field="phone" outcome={outcome} />
                <ContactField person={person} field="email" outcome={outcome} />
                <ContactField person={person} field="availability" outcome={outcome} />
              </div>
              <ContactField person={person} field="note" outcome={outcome} />
              <PersonStages person={person} snapshot={snapshot} outcome={outcome} />
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

/** Each contact field: its test id, its words, its limit. */
const FIELDS = {
  trade: {
    testId: 'person-trade',
    label: 'plan.person.trade',
    hint: 'plan.person.tradeHint',
    max: LIMITS.trade,
  },
  phone: {
    testId: 'person-phone',
    label: 'plan.person.phone',
    hint: 'plan.person.phoneHint',
    max: LIMITS.phone,
  },
  email: {
    testId: 'person-email',
    label: 'plan.person.email',
    hint: 'plan.person.emailHint',
    max: LIMITS.email,
  },
  availability: {
    testId: 'person-availability',
    label: 'plan.person.availability',
    hint: 'plan.person.availabilityHint',
    max: LIMITS.availability,
  },
  note: {
    testId: 'person-note',
    label: 'plan.person.note',
    hint: 'plan.person.noteHint',
    max: LIMITS.personNote,
  },
} as const satisfies Record<
  string,
  { testId: string; label: MessageKey; hint: MessageKey; max: number }
>;

type Field = keyof typeof FIELDS;

/**
 * One contact field — trade (F6), phone, e-mail, availability, note (F7) — kept as it is typed: a
 * contact detail is a word, not a decision, and an empty one clears it. Stored as typed and never
 * used to reach anybody: the product has no network, and the card says so once.
 */
function ContactField({
  person,
  field,
  outcome,
}: {
  person: Person;
  field: Field;
  outcome: Outcome;
}) {
  const { t } = useI18n();
  const update = useUpdatePerson();
  const spec = FIELDS[field];
  const [value, setValue] = useState(person[field] ?? '');

  return (
    <Input
      data-testid={spec.testId}
      className={field === 'trade' ? 'w-48' : ''}
      type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
      aria-label={t(spec.label, { name: person.name })}
      placeholder={t(spec.hint)}
      maxLength={spec.max}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        update.mutate(
          { id: person.id, patch: { [field]: next.trim() === '' ? null : next.trim() } },
          { onSuccess: outcome.kept, onError: outcome.refused },
        );
      }}
    />
  );
}

/** The stages a person is expected on, as a row of boxes — one per stage, in plan order. */
function PersonStages({
  person,
  snapshot,
  outcome,
}: {
  person: Person;
  snapshot: WorkSnapshot;
  outcome: Outcome;
}) {
  const { t } = useI18n();
  const setStages = useSetPersonStages();
  const stages = stagesInOrder(snapshot);
  const [chosen, setChosen] = useState<readonly string[]>(person.stageIds);
  if (stages.length === 0) return null;

  return (
    <fieldset data-testid="person-stages" className="flex flex-col gap-1">
      <legend className="mb-1 text-caption font-semibold text-fg-tertiary">
        {t('plan.person.stages')}
      </legend>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {stages.map((stage) => (
          <label key={stage.id} className="flex items-center gap-1.5 text-body text-fg">
            <Checkbox
              label={t('plan.person.onStage', { name: person.name, stage: stage.name })}
              checked={chosen.includes(stage.id)}
              onChange={(on) => {
                const set = new Set(chosen);
                if (on) set.add(stage.id);
                else set.delete(stage.id);
                const next = stages.filter((each) => set.has(each.id)).map((each) => each.id);
                setChosen(next);
                setStages.mutate(
                  { id: person.id, stageIds: next },
                  { onSuccess: outcome.kept, onError: outcome.refused },
                );
              }}
            />
            <span>{stage.name}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}
