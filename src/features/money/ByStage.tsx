import { Add20Regular, Delete20Regular, Warning16Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { today as todayOf } from '@/app/today';
import { LIMITS } from '@/data/commands';
import { useAddCommitment, useRemoveCommitment } from '@/data/queries';
import { moneyByStage, moneyOfWork, type StageMoney } from '@/domain/money';
import { stagesInOrder, type Stage, type WorkSnapshot } from '@/domain/plan';
import { toCents } from '@/i18n/format';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { MoneyCell } from './MoneyCell';

type Outcome = { kept: () => void; refused: (error: unknown) => void };

const COLUMNS = ['planned', 'committed', 'paid', 'remaining', 'variance'] as const;

/**
 * Money by stage (slice F6): each stage's planned, committed, paid, remaining and variance — every
 * one a button that opens onto its rows — and the whole work above them. A stage paid over what was
 * committed is allowed and marked, in words, with the excess (ADR-024). Under each stage, its
 * commitments — quotes and contracts accepted — and the line that adds one.
 */
export function ByStage({ snapshot, outcome }: { snapshot: WorkSnapshot; outcome: Outcome }) {
  const { t } = useI18n();
  const term = useTerms();
  const stages = stagesInOrder(snapshot);
  const byStage = new Map(moneyByStage(snapshot).map((row) => [row.stageId, row]));
  const work = moneyOfWork(snapshot);

  if (stages.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t('plan.stages.emptyTitle')}
          description={t('plan.stages.emptyDescription')}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,1fr)_repeat(5,8.5rem)] gap-2 px-4 text-caption font-semibold text-fg-tertiary md:grid"
      >
        <span>{term('stage', { capital: true })}</span>
        {COLUMNS.map((column) => (
          <span key={column}>{term(column, { capital: true })}</span>
        ))}
      </div>
      <Card>
        <div data-money-work className="grid gap-2 md:grid-cols-[minmax(0,1fr)_repeat(5,8.5rem)]">
          <span className="text-body font-semibold text-fg">{t('money.total')}</span>
          {COLUMNS.map((column) => (
            <MoneyCell
              key={column}
              name={`work-${column}`}
              figure={work[column]}
              label={t('money.valueOf', {
                figure: term(column, { capital: true }),
                name: t('money.total'),
              })}
              currency={snapshot.work.currency}
            />
          ))}
        </div>
      </Card>
      <ol className="flex flex-col gap-3">
        {stages.map((stage) => {
          const money = byStage.get(stage.id);
          return money === undefined ? null : (
            <StageMoneyCard
              key={stage.id}
              stage={stage}
              money={money}
              snapshot={snapshot}
              outcome={outcome}
            />
          );
        })}
      </ol>
    </div>
  );
}

function StageMoneyCard({
  stage,
  money: figures,
  snapshot,
  outcome,
}: {
  stage: Stage;
  money: StageMoney;
  snapshot: WorkSnapshot;
  outcome: Outcome;
}) {
  const { t, money, day } = useI18n();
  const term = useTerms();
  const remove = useRemoveCommitment();
  const currency = snapshot.work.currency;
  const commitments = snapshot.commitments.filter((each) => each.stageId === stage.id);
  const paidAgainst = new Set(snapshot.payments.map((payment) => payment.commitmentId));
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));

  return (
    <li data-money-stage={stage.id}>
      <Card>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_repeat(5,8.5rem)]">
          <div className="flex flex-col gap-1">
            <h2 className="text-body font-semibold text-fg">{stage.name}</h2>
            {figures.overCommittedCents !== null && (
              <span
                data-testid="over-committed"
                className="inline-flex w-fit items-center gap-1 rounded-md bg-caution-subtle px-2 py-0.5 text-caption text-fg"
              >
                <Warning16Regular aria-hidden="true" className="text-caution" />
                {t('money.overCommitted.mark', {
                  amount: money(figures.overCommittedCents, currency),
                })}
              </span>
            )}
          </div>
          {COLUMNS.map((column) => (
            <MoneyCell
              key={column}
              name={column}
              figure={figures[column]}
              label={t('money.valueOf', {
                figure: term(column, { capital: true }),
                name: stage.name,
              })}
              currency={currency}
            />
          ))}
        </div>

        <section className="mt-3 border-t border-stroke-subtle pt-3">
          <h3 className="mb-1 text-caption font-semibold text-fg-secondary">
            {t('money.commitments.title')}
          </h3>
          {commitments.length === 0 ? (
            <p className="text-caption text-fg-tertiary">{t('money.commitments.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {commitments.map((commitment) => {
                const locked = paidAgainst.has(commitment.id);
                return (
                  <li
                    key={commitment.id}
                    data-commitment-id={commitment.id}
                    className="flex items-center gap-2 text-body text-fg"
                  >
                    <span className="min-w-0 flex-1">
                      {t('money.commitment.line', {
                        label: commitment.label,
                        person:
                          commitment.personId === null
                            ? t('money.commitment.nobody')
                            : (people.get(commitment.personId) ?? '?'),
                        amount: money(commitment.amountCents, currency),
                        day: day(commitment.agreedOn),
                      })}
                    </span>
                    {locked ? (
                      <span className="text-caption text-fg-tertiary">
                        {t('money.commitment.locked')}
                      </span>
                    ) : (
                      <IconButton
                        data-testid="commitment-remove"
                        icon={<Delete20Regular />}
                        label={t('money.commitment.remove', { name: commitment.label })}
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate(commitment.id, {
                            onSuccess: outcome.kept,
                            onError: outcome.refused,
                          })
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <AddCommitment stage={stage} snapshot={snapshot} outcome={outcome} />
        </section>
      </Card>
    </li>
  );
}

function AddCommitment({
  stage,
  snapshot,
  outcome,
}: {
  stage: Stage;
  snapshot: WorkSnapshot;
  outcome: Outcome;
}) {
  const { t } = useI18n();
  const add = useAddCommitment();
  const hint = useId();
  const [label, setLabel] = useState('');
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [agreedOn, setAgreedOn] = useState(() => todayOf());
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cents = toCents(amount);
    if (label.trim() === '') {
      setProblem(t('plan.invalid.name'));
      return;
    }
    if (cents === null) {
      setProblem(t('money.invalid.amount'));
      return;
    }
    setProblem(null);
    add.mutate(
      {
        stageId: stage.id,
        personId: person === '' ? null : person,
        label: label.trim(),
        amountCents: cents,
        agreedOn,
      },
      {
        onSuccess: () => {
          outcome.kept();
          setLabel('');
          setAmount('');
        },
        onError: outcome.refused,
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="mt-2 flex flex-col gap-1">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_8rem_10rem_auto]">
        <Input
          data-testid="commitment-add-label"
          aria-label={t('money.commitment.label')}
          placeholder={t('money.commitment.label')}
          aria-describedby={problem !== null ? hint : undefined}
          maxLength={LIMITS.costLabel}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Select
          data-testid="commitment-add-person"
          aria-label={t('money.commitment.person')}
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          <option value="">{t('money.commitment.nobody')}</option>
          {snapshot.people.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          data-testid="commitment-add-amount"
          aria-label={t('money.costLine.amountIn', { currency: snapshot.work.currency })}
          placeholder={snapshot.work.currency}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          type="date"
          data-testid="commitment-add-day"
          aria-label={t('money.commitment.day')}
          value={agreedOn}
          onChange={(event) => setAgreedOn(event.target.value)}
        />
        <Button
          type="submit"
          icon={<Add20Regular />}
          data-testid="commitment-add"
          disabled={add.isPending}
        >
          {t('money.commitment.add')}
        </Button>
      </div>
      {problem !== null && (
        <span id={hint} className="text-caption text-fg-secondary">
          {problem}
        </span>
      )}
    </form>
  );
}
