import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  Delete20Regular,
  TaskListAdd20Regular,
} from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { LIMITS } from '@/data/commands';
import { useAddCheck, useAddDefaultChecks, useRemoveCheck, useRenameCheck } from '@/data/queries';
import { checksAt, DEFAULT_CHECK_KEYS, GATES, latestAnswers } from '@/domain/checks';
import type { Direction } from '@/domain/ordering';
import type { Check, Gate, Stage, WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { chordDirection } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';

/**
 * A stage's checks, edited per work (slice F5): the questions it must answer before it starts and
 * before it closes. They are answered on the Gates tab; here they are named, ordered and removed.
 *
 * Until templates arrive (F9), "Add the usual checks" inserts a small library in the person's
 * language as ordinary checks — the domain names them by key, this resolves the keys. A check that
 * has an answer cannot be removed, because its answers are facts; it can still be renamed.
 */
export function ChecksBlock({
  stage,
  snapshot,
  outcome,
  readOnly,
  onMove,
}: {
  stage: Stage;
  snapshot: WorkSnapshot;
  outcome: Outcome;
  readOnly: boolean;
  onMove: (check: Check, direction: Direction, siblings: readonly string[]) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const defaults = useAddDefaultChecks();
  const answered = new Set(latestAnswers(snapshot.checkAnswers).keys());
  const byGate = GATES.map((gate) => ({ gate, checks: checksAt(snapshot.checks, stage.id, gate) }));
  const any = byGate.some(({ checks }) => checks.length > 0);
  const anyAnswered = byGate.some(({ checks }) => checks.some((check) => answered.has(check.id)));

  return (
    <section
      data-testid="checks"
      aria-label={t('plan.fieldOf', { field: t('checks.title'), name: stage.name })}
      className="mb-3 rounded-lg border border-stroke-subtle bg-layer p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-caption font-semibold text-fg-secondary">{t('checks.title')}</h4>
        <Button
          appearance="subtle"
          icon={<TaskListAdd20Regular />}
          data-testid="checks-add-defaults"
          disabled={readOnly || defaults.isPending}
          onClick={() =>
            defaults.mutate(
              {
                stageId: stage.id,
                start: DEFAULT_CHECK_KEYS.start.map((key) => t(key)),
                close: DEFAULT_CHECK_KEYS.close.map((key) => t(key)),
              },
              { onSuccess: outcome.kept, onError: outcome.refused },
            )
          }
        >
          {t('checks.addDefaults')}
        </Button>
      </div>
      {!any && <p className="mb-2 text-caption text-fg-tertiary">{t('checks.none')}</p>}
      {any && (
        <div className="grid gap-3 md:grid-cols-2">
          {byGate.map(({ gate, checks }) => (
            <div key={gate} data-gate={gate} className="flex flex-col gap-1">
              <h5 className="text-caption font-semibold text-fg-tertiary">
                {term(gate === 'start' ? 'startGate' : 'closeGate', { capital: true })}
              </h5>
              {checks.length === 0 ? (
                <p className="text-caption text-fg-tertiary">{t('checks.none')}</p>
              ) : (
                <ul className="flex flex-col">
                  {checks.map((check) => (
                    <CheckLine
                      key={check.id}
                      check={check}
                      answered={answered.has(check.id)}
                      readOnly={readOnly}
                      outcome={outcome}
                      onMove={(direction) =>
                        onMove(
                          check,
                          direction,
                          checks.map((each) => each.id),
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {anyAnswered && (
        <p className="mt-2 text-caption text-fg-tertiary">{t('checks.keepAnswered')}</p>
      )}
      {!readOnly && <AddCheck stage={stage} outcome={outcome} />}
    </section>
  );
}

function CheckLine({
  check,
  answered,
  readOnly,
  outcome,
  onMove,
}: {
  check: Check;
  answered: boolean;
  readOnly: boolean;
  outcome: Outcome;
  onMove: (direction: Direction) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const rename = useRenameCheck();
  const remove = useRemoveCheck();

  return (
    <li
      data-check-id={check.id}
      className="flex items-start gap-1 border-t border-stroke-subtle py-1 first:border-t-0"
      onKeyDown={(event) => {
        if (readOnly) return;
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      {readOnly ? (
        <span className="min-w-0 flex-1 py-1.5 text-body text-fg">{check.name}</span>
      ) : (
        <NameField
          key={check.name}
          value={check.name}
          label={t('plan.fieldOf', { field: term('check', { capital: true }), name: check.name })}
          onCommit={(name) =>
            rename.mutate(
              { id: check.id, name },
              { onSuccess: outcome.kept, onError: outcome.refused },
            )
          }
        />
      )}
      <IconButton
        data-testid="check-up"
        icon={<ArrowUp20Regular />}
        label={t('plan.move.up', { name: check.name })}
        disabled={readOnly}
        onClick={() => onMove('up')}
      />
      <IconButton
        data-testid="check-down"
        icon={<ArrowDown20Regular />}
        label={t('plan.move.down', { name: check.name })}
        disabled={readOnly}
        onClick={() => onMove('down')}
      />
      <IconButton
        data-testid="check-remove"
        icon={<Delete20Regular />}
        label={t('plan.removeNamed', { name: check.name })}
        disabled={readOnly || answered || remove.isPending}
        onClick={() =>
          remove.mutate(check.id, { onSuccess: outcome.kept, onError: outcome.refused })
        }
      />
    </li>
  );
}

function AddCheck({ stage, outcome }: { stage: Stage; outcome: Outcome }) {
  const { t } = useI18n();
  const term = useTerms();
  const add = useAddCheck();
  const hint = useId();
  const [name, setName] = useState('');
  const [gate, setGate] = useState<Gate>('start');
  const [empty, setEmpty] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    add.mutate(
      { stageId: stage.id, gate, name: name.trim() },
      {
        onSuccess: () => {
          outcome.kept();
          setName('');
        },
        onError: outcome.refused,
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="mt-2 flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_11rem_auto] gap-2">
        <Input
          data-testid="check-add-name"
          aria-label={t('plan.toAddIn', {
            what: term('check', { capital: true }),
            where: stage.name,
          })}
          placeholder={t('plan.toAddIn', {
            what: term('check', { capital: true }),
            where: stage.name,
          })}
          aria-invalid={empty}
          aria-describedby={empty ? hint : undefined}
          maxLength={LIMITS.checkName}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (empty) setEmpty(false);
          }}
        />
        <Select
          data-testid="check-add-gate"
          aria-label={t('checks.gateOf')}
          value={gate}
          onChange={(event) => setGate(event.target.value === 'close' ? 'close' : 'start')}
        >
          <option value="start">{term('startGate', { capital: true })}</option>
          <option value="close">{term('closeGate', { capital: true })}</option>
        </Select>
        <Button
          type="submit"
          icon={<Add20Regular />}
          data-testid="check-add"
          disabled={add.isPending}
        >
          {t('plan.add', { what: term('check') })}
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
