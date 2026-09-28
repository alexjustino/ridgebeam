import { Add20Regular, Delete20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { LIMITS } from '@/data/commands';
import { useAddCostLine, useRemoveCostLine, useUpdateCostLine } from '@/data/queries';
import type { CostLine, WorkSnapshot } from '@/domain/plan';
import { fromCents, toCents } from '@/i18n/format';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';

import { NameField } from './NameField';
import type { Outcome } from './outcome';

/**
 * The money planned for a stage or for one of its activities (slice F6): cost lines, each a label
 * and an amount, several allowed. Amounts are typed in major units — `1200.50` — and kept in whole
 * cents; the host never sees a float (ADR-023). A stage's planned money is its own lines plus its
 * activities'.
 *
 * The stage's own add line and an activity's carry different test ids, because the stage's
 * container holds its activities too: `stage-cost-line-add-*` and `cost-line-add-*`.
 */
export function CostLines({
  snapshot,
  stageId,
  activityId,
  outcome,
  readOnly,
}: {
  snapshot: WorkSnapshot;
  stageId: string;
  /** `null` for the stage's own lines. */
  activityId: string | null;
  outcome: Outcome;
  readOnly: boolean;
}) {
  const { t, money } = useI18n();
  const lines = snapshot.costLines.filter(
    (line) => line.stageId === stageId && line.activityId === activityId,
  );
  const prefix = activityId === null ? 'stage-cost-line' : 'cost-line';
  const currency = snapshot.work.currency;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-tertiary">
        {activityId === null ? t('money.costLines.stage') : t('money.costLines')}
      </span>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <CostLineRow
              key={line.id}
              line={line}
              currency={currency}
              readOnly={readOnly}
              outcome={outcome}
            />
          ))}
        </ul>
      )}
      {lines.length === 0 && readOnly && (
        <span className="text-caption text-fg-tertiary">{t('money.costLine.none')}</span>
      )}
      {lines.length > 1 && (
        <span className="text-caption text-fg-secondary">
          {money(
            lines.reduce((sum, line) => sum + line.amountCents, 0),
            currency,
          )}
        </span>
      )}
      {!readOnly && (
        <AddCostLine
          stageId={stageId}
          activityId={activityId}
          currency={currency}
          prefix={prefix}
          outcome={outcome}
        />
      )}
    </div>
  );
}

function CostLineRow({
  line,
  currency,
  readOnly,
  outcome,
}: {
  line: CostLine;
  currency: string;
  readOnly: boolean;
  outcome: Outcome;
}) {
  const { t, money } = useI18n();
  const update = useUpdateCostLine();
  const remove = useRemoveCostLine();
  const hint = useId();
  const [amount, setAmount] = useState(fromCents(line.amountCents));
  const [invalid, setInvalid] = useState(false);

  const editAmount = (next: string) => {
    setAmount(next);
    const cents = toCents(next);
    if (cents === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (cents !== line.amountCents) {
      update.mutate(
        { id: line.id, patch: { amountCents: cents } },
        { onSuccess: outcome.kept, onError: outcome.refused },
      );
    }
  };

  if (readOnly) {
    return (
      <li data-cost-line-id={line.id} className="flex gap-3 text-body text-fg">
        <span className="min-w-0 flex-1 truncate">{line.label}</span>
        <span className="tabular-nums">{money(line.amountCents, currency)}</span>
      </li>
    );
  }

  return (
    <li data-cost-line-id={line.id} className="flex flex-col gap-0.5">
      <div className="grid grid-cols-[minmax(0,1fr)_9rem_auto] items-start gap-2">
        <NameField
          key={line.label}
          value={line.label}
          label={t('plan.fieldOf', { field: t('money.costLines'), name: line.label })}
          onCommit={(label) =>
            update.mutate(
              { id: line.id, patch: { label } },
              { onSuccess: outcome.kept, onError: outcome.refused },
            )
          }
        />
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          data-testid="cost-line-amount"
          aria-label={t('money.costLine.amountOf', { name: line.label })}
          aria-invalid={invalid}
          aria-describedby={invalid ? hint : undefined}
          value={amount}
          onChange={(event) => editAmount(event.target.value)}
        />
        <IconButton
          data-testid="cost-line-remove"
          icon={<Delete20Regular />}
          label={t('plan.removeNamed', { name: line.label })}
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(line.id, { onSuccess: outcome.kept, onError: outcome.refused })
          }
        />
      </div>
      {invalid && (
        <span id={hint} className="text-caption text-fg-secondary">
          {t('money.invalid.amount')}
        </span>
      )}
    </li>
  );
}

function AddCostLine({
  stageId,
  activityId,
  currency,
  prefix,
  outcome,
}: {
  stageId: string;
  activityId: string | null;
  currency: string;
  prefix: string;
  outcome: Outcome;
}) {
  const { t } = useI18n();
  const add = useAddCostLine();
  const hint = useId();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
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
      { stageId, activityId, label: label.trim(), amountCents: cents },
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
    <form onSubmit={submit} noValidate className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_9rem_auto] gap-2">
        <Input
          data-testid={`${prefix}-add-label`}
          aria-label={t('money.costLine.toAdd')}
          placeholder={t('money.costLine.toAdd')}
          aria-describedby={problem !== null ? hint : undefined}
          maxLength={LIMITS.costLabel}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          data-testid={`${prefix}-add-amount`}
          aria-label={t('money.costLine.amountIn', { currency })}
          placeholder={currency}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button
          type="submit"
          icon={<Add20Regular />}
          data-testid={`${prefix}-add`}
          disabled={add.isPending}
        >
          {t('money.costLine.add')}
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
