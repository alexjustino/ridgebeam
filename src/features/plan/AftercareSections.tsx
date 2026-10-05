import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  CalendarLtr16Regular,
  CheckmarkCircle20Regular,
  Clock16Regular,
  Delete20Regular,
  Edit20Regular,
  ShieldCheckmark16Regular,
  ShieldDismiss16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useToday } from '@/app/today';
import { useRemoveMaintenance, useRemoveWarranty } from '@/data/queries';
import {
  AFTERCARE_TASK_STATE_KEYS,
  AFTERCARE_WARRANTY_STATE_KEYS,
  maintenanceRows,
  warrantyRows,
  type AftercareTarget,
  type MaintenanceRow,
  type MaintenanceState,
  type MaintenanceTask,
  type Warranty,
  type WarrantyRow,
  type WarrantyState,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';

import { MaintenanceDoneDialog } from './MaintenanceDoneDialog';
import { MaintenanceForm } from './MaintenanceForm';
import { WarrantyForm } from './WarrantyForm';
import {
  aftercareCoversText,
  aftercareTargetText,
  taskCycleText,
  taskDueText,
  warrantyEndsText,
  warrantyFromText,
} from './aftercareWords';
import { chordDirection, useMover } from './moves';
import type { Outcome } from './outcome';

/** A run of rows on one target, under the heading that names it. */
interface Group<Row extends AftercareTarget> {
  readonly key: string;
  readonly target: AftercareTarget;
  readonly rows: readonly Row[];
}

/**
 * Rows in target order (the domain's), cut where the target changes: the work's, each room's, each
 * stage's, then any whose target is gone. A move stays inside its group, as a care note's does.
 */
function groupsOf<Row extends AftercareTarget>(rows: readonly Row[]): Group<Row>[] {
  const groups: Array<{ key: string; target: AftercareTarget; rows: Row[] }> = [];
  for (const row of rows) {
    const key = `${row.targetKind}:${row.targetId}`;
    const last = groups.at(-1);
    if (last !== undefined && last.key === key) last.rows.push(row);
    else groups.push({ key, target: row, rows: [row] });
  }
  return groups;
}

/** A refusal said in the section it happened in; the next thing kept takes it away. */
function useSectionOutcome() {
  const { describeError } = useI18n();
  const [refusal, setRefusal] = useState<string | null>(null);
  const outcome: Outcome = useMemo(
    () => ({
      refused: (error: unknown) => setRefusal(describeError(error)),
      kept: () => setRefusal(null),
    }),
    [describeError],
  );
  return { refusal, outcome };
}

/** Rows that take the focus after they were added, saved or recorded. */
function useRowFocus(snapshot: WorkSnapshot) {
  const focusNext = useRef<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const register = useCallback((id: string, element: HTMLLIElement | null) => {
    if (element === null) rows.current.delete(id);
    else rows.current.set(id, element);
  }, []);
  useEffect(() => {
    if (focusNext.current === null) return;
    rows.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [snapshot]);
  /** Put the focus on this row once the plan that holds it is drawn. */
  const focusAfter = useCallback((id: string | null) => {
    focusNext.current = id;
  }, []);
  return { focusAfter, register };
}

/** A state said in words, with its icon: never colour alone (DESIGN_SYSTEM §2). */
function StateChip({
  testId,
  tone,
  icon,
  children,
}: {
  testId: string;
  tone: 'caution' | 'info' | 'neutral';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      data-testid={testId}
      className={[
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption text-fg',
        tone === 'caution'
          ? 'bg-caution-subtle'
          : tone === 'info'
            ? 'bg-info-subtle'
            : 'bg-card-hover',
      ].join(' ')}
    >
      {icon}
      {children}
    </span>
  );
}

const WARRANTY_TONE: Record<WarrantyState, 'caution' | 'info' | 'neutral'> = {
  active: 'neutral',
  'ending-soon': 'caution',
  ended: 'neutral',
};

function warrantyIcon(state: WarrantyState): ReactNode {
  if (state === 'ending-soon')
    return <Warning16Regular aria-hidden="true" className="text-caution" />;
  if (state === 'ended') return <ShieldDismiss16Regular aria-hidden="true" />;
  return <ShieldCheckmark16Regular aria-hidden="true" />;
}

const TASK_TONE: Record<MaintenanceState, 'caution' | 'info' | 'neutral'> = {
  overdue: 'caution',
  'due-soon': 'info',
  scheduled: 'neutral',
};

function taskIcon(state: MaintenanceState): ReactNode {
  if (state === 'overdue') return <Warning16Regular aria-hidden="true" className="text-caution" />;
  if (state === 'due-soon') return <Clock16Regular aria-hidden="true" className="text-info" />;
  return <CalendarLtr16Regular aria-hidden="true" />;
}

// ── Warranties ───────────────────────────────────────────────────────────────

/**
 * The Handover tab's **Warranties** section (slice G4, decision 3; pt "Garantias"): what the papers
 * the work came with promise — each with what it covers, who gives it, from when and for how long,
 * and the day it ends **and how far that is**, in words with an icon (`[data-warranty-id]`,
 * `data-state`, `data-ends`). A warranty is what its paper says: edited, moved among those of its
 * target, and removed at any time. **Add a warranty…** (`warranty-add`) opens the form in a dialog.
 */
export function WarrantiesSection({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t } = useI18n();
  const today = useToday();
  const remove = useRemoveWarranty();
  const { refusal, outcome } = useSectionOutcome();
  const { go } = useMover(outcome);
  const { focusAfter, register } = useRowFocus(snapshot);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Warranty | null>(null);
  const [removing, setRemoving] = useState<Warranty | null>(null);
  const rows = useMemo(() => warrantyRows(snapshot, today), [snapshot, today]);
  const byId = new Map(snapshot.warranties.map((warranty) => [warranty.id, warranty]));

  const confirmRemove = () => {
    if (removing === null) return;
    const gone = removing;
    remove.mutate(gone.id, {
      onSuccess: () => {
        setRemoving(null);
        outcome.kept();
        announce(t('aftercare.warranty.removed', { name: gone.title }));
        requestAnimationFrame(() => addButton.current?.focus());
      },
      onError: (error) => {
        setRemoving(null);
        outcome.refused(error);
      },
    });
  };

  return (
    <div data-testid="aftercare-warranties">
      <Card
        title={t('aftercare.warranties.title')}
        description={t('aftercare.warranties.lead')}
        actions={
          <Button
            ref={addButton}
            icon={<Add20Regular />}
            data-testid="warranty-add"
            className="shrink-0"
            onClick={() => setAdding(true)}
          >
            {t('aftercare.warranty.add')}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <p data-testid="warranties-none" className="text-body text-fg-tertiary">
            {t('aftercare.warranties.none')}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupsOf(rows).map((group) => {
              const ids = group.rows.map((row) => row.warrantyId);
              return (
                <section key={group.key} className="flex flex-col gap-2">
                  <h3 className="text-body font-semibold text-fg">
                    {aftercareTargetText({ t }, group.target)}
                  </h3>
                  <ul className="flex flex-col gap-3">
                    {group.rows.map((row) => (
                      <WarrantyLine
                        key={row.warrantyId}
                        ref={(element) => register(row.warrantyId, element)}
                        row={row}
                        warranty={byId.get(row.warrantyId)}
                        onMove={(direction) =>
                          go('warranty', row.warrantyId, direction, ids, row.title)
                        }
                        onEdit={setEditing}
                        onRemove={setRemoving}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {refusal !== null && (
          <div data-testid="warranty-section-refused" className="mt-3">
            <InfoBar severity="danger" title={t('plan.refused')}>
              {refusal}
            </InfoBar>
          </div>
        )}
      </Card>

      {/* Mounted only while open, so each opening starts from the warranty as it is now. */}
      {(adding || editing !== null) && (
        <Modal
          open
          label={
            editing === null
              ? t('aftercare.warranty.form.add')
              : t('aftercare.warranty.form.edit', { name: editing.title })
          }
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          width="lg"
        >
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
            <h2 className="text-body-lg font-semibold text-fg">
              {editing === null
                ? t('aftercare.warranty.form.add')
                : t('aftercare.warranty.form.edit', { name: editing.title })}
            </h2>
            <WarrantyForm
              snapshot={snapshot}
              warranty={editing}
              onDone={(warrantyId) => {
                setAdding(false);
                setEditing(null);
                outcome.kept();
                focusAfter(warrantyId);
              }}
              onCancel={() => {
                setAdding(false);
                setEditing(null);
              }}
            />
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={
          removing === null ? '' : t('aftercare.warranty.remove.title', { name: removing.title })
        }
        confirmLabel={t('aftercare.remove.confirm')}
        confirmTestId="warranty-remove-confirm"
        danger
        pending={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      >
        <p>{t('aftercare.warranty.remove.body')}</p>
      </ConfirmDialog>
    </div>
  );
}

function WarrantyLine({
  ref,
  row,
  warranty,
  onMove,
  onEdit,
  onRemove,
}: {
  ref: (element: HTMLLIElement | null) => void;
  row: WarrantyRow;
  warranty: Warranty | undefined;
  onMove: (direction: 'up' | 'down') => void;
  onEdit: (warranty: Warranty) => void;
  onRemove: (warranty: Warranty) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const document = row.document;

  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-warranty-id={row.warrantyId}
      data-state={row.state}
      data-ends={row.endsOn ?? ''}
      aria-label={row.title}
      className="flex flex-col gap-1 border-t border-stroke-subtle pt-3 first:border-t-0 first:pt-0"
      onKeyDown={(event) => {
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-body-lg font-semibold text-fg">{row.title}</h4>
        <StateChip
          testId="warranty-state"
          tone={WARRANTY_TONE[row.state]}
          icon={warrantyIcon(row.state)}
        >
          {t(AFTERCARE_WARRANTY_STATE_KEYS[row.state] as MessageKey)}
        </StateChip>
      </div>
      <p className="text-body text-fg-secondary">
        {[
          aftercareCoversText(i18n, row),
          row.givenBy === null ? null : t('aftercare.warranty.givenBy', { name: row.givenBy }),
          warrantyFromText(i18n, row),
        ]
          .filter((part) => part !== null)
          .join(' · ')}
      </p>
      <p
        data-testid="warranty-ends"
        className={
          row.state === 'ending-soon' ? 'text-body font-semibold text-fg' : 'text-body text-fg'
        }
      >
        {warrantyEndsText(i18n, row)}
      </p>
      <p className="text-body text-fg-secondary">
        {document === null
          ? t('aftercare.warranty.noDocument')
          : t('aftercare.warranty.document', {
              title:
                document.title === document.fileName
                  ? document.title
                  : t('reports.handover.documents.file', {
                      title: document.title,
                      file: document.fileName,
                    }),
            })}
      </p>
      {row.note !== null && <p className="text-body whitespace-pre-line text-fg">{row.note}</p>}
      {warranty !== undefined && (
        <div className="flex items-center gap-1">
          <IconButton
            data-testid="warranty-edit"
            icon={<Edit20Regular />}
            label={t('aftercare.editNamed', { name: row.title })}
            onClick={() => onEdit(warranty)}
          />
          <IconButton
            data-testid="warranty-up"
            icon={<ArrowUp20Regular />}
            label={t('plan.move.up', { name: row.title })}
            onClick={() => onMove('up')}
          />
          <IconButton
            data-testid="warranty-down"
            icon={<ArrowDown20Regular />}
            label={t('plan.move.down', { name: row.title })}
            onClick={() => onMove('down')}
          />
          <IconButton
            data-testid="warranty-remove"
            icon={<Delete20Regular />}
            label={t('plan.removeNamed', { name: row.title })}
            onClick={() => onRemove(warranty)}
          />
        </div>
      )}
    </li>
  );
}

// ── Maintenance ──────────────────────────────────────────────────────────────

/**
 * The Handover tab's **Maintenance** section (slice G4, decision 3; pt "Manutenção periódica"): what
 * the work needs again and again, every so many calendar months — kept apart from the care notes,
 * which are sentences: a task has a cycle. Each task (`[data-task-id]`, `data-next`,
 * `data-overdue`) says how often, how many times it was done and when last, and the day it is next
 * due **and how far that is**, in words with an icon. **Mark as done…** (`maintenance-done`) records
 * one time it was done, a fact listed under the row with no Edit and no Delete. A task with a record
 * offers no Remove, and says why.
 */
export function MaintenanceSection({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t } = useI18n();
  const today = useToday();
  const remove = useRemoveMaintenance();
  const { refusal, outcome } = useSectionOutcome();
  const { go } = useMover(outcome);
  const { focusAfter, register } = useRowFocus(snapshot);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MaintenanceTask | null>(null);
  const [removing, setRemoving] = useState<MaintenanceTask | null>(null);
  const [recording, setRecording] = useState<MaintenanceTask | null>(null);
  const rows = useMemo(() => maintenanceRows(snapshot, today), [snapshot, today]);
  const byId = new Map(snapshot.maintenance.map((task) => [task.id, task]));

  const confirmRemove = () => {
    if (removing === null) return;
    const gone = removing;
    remove.mutate(gone.id, {
      onSuccess: () => {
        setRemoving(null);
        outcome.kept();
        announce(t('aftercare.task.removed', { name: gone.title }));
        requestAnimationFrame(() => addButton.current?.focus());
      },
      onError: (error) => {
        setRemoving(null);
        outcome.refused(error);
      },
    });
  };

  return (
    <div data-testid="aftercare-maintenance">
      <Card
        title={t('aftercare.maintenance.title')}
        description={t('aftercare.maintenance.lead')}
        actions={
          <Button
            ref={addButton}
            icon={<Add20Regular />}
            data-testid="maintenance-add"
            className="shrink-0"
            onClick={() => setAdding(true)}
          >
            {t('aftercare.task.add')}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <p data-testid="maintenance-none" className="text-body text-fg-tertiary">
            {t('aftercare.maintenance.none')}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupsOf(rows).map((group) => {
              const ids = group.rows.map((row) => row.taskId);
              return (
                <section key={group.key} className="flex flex-col gap-2">
                  <h3 className="text-body font-semibold text-fg">
                    {aftercareTargetText({ t }, group.target)}
                  </h3>
                  <ul className="flex flex-col gap-3">
                    {group.rows.map((row) => (
                      <TaskLine
                        key={row.taskId}
                        ref={(element) => register(row.taskId, element)}
                        row={row}
                        task={byId.get(row.taskId)}
                        onMove={(direction) =>
                          go('maintenance', row.taskId, direction, ids, row.title)
                        }
                        onDone={setRecording}
                        onEdit={setEditing}
                        onRemove={setRemoving}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {refusal !== null && (
          <div data-testid="maintenance-section-refused" className="mt-3">
            <InfoBar severity="danger" title={t('plan.refused')}>
              {refusal}
            </InfoBar>
          </div>
        )}
      </Card>

      {(adding || editing !== null) && (
        <Modal
          open
          label={
            editing === null
              ? t('aftercare.task.form.add')
              : t('aftercare.task.form.edit', { name: editing.title })
          }
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          width="lg"
        >
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
            <h2 className="text-body-lg font-semibold text-fg">
              {editing === null
                ? t('aftercare.task.form.add')
                : t('aftercare.task.form.edit', { name: editing.title })}
            </h2>
            <MaintenanceForm
              snapshot={snapshot}
              task={editing}
              onDone={(taskId) => {
                setAdding(false);
                setEditing(null);
                outcome.kept();
                focusAfter(taskId);
              }}
              onCancel={() => {
                setAdding(false);
                setEditing(null);
              }}
            />
          </div>
        </Modal>
      )}
      {recording !== null && (
        <MaintenanceDoneDialog
          snapshot={snapshot}
          task={recording}
          onClose={() => setRecording(null)}
          onRecorded={(task) => {
            setRecording(null);
            outcome.kept();
            announce(t('aftercare.done.announced', { name: task.title }));
            focusAfter(task.id);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removing === null ? '' : t('aftercare.task.remove.title', { name: removing.title })}
        confirmLabel={t('aftercare.remove.confirm')}
        confirmTestId="maintenance-remove-confirm"
        danger
        pending={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      >
        <p>{t('aftercare.task.remove.body')}</p>
      </ConfirmDialog>
    </div>
  );
}

function TaskLine({
  ref,
  row,
  task,
  onMove,
  onDone,
  onEdit,
  onRemove,
}: {
  ref: (element: HTMLLIElement | null) => void;
  row: MaintenanceRow;
  task: MaintenanceTask | undefined;
  onMove: (direction: 'up' | 'down') => void;
  onDone: (task: MaintenanceTask) => void;
  onEdit: (task: MaintenanceTask) => void;
  onRemove: (task: MaintenanceTask) => void;
}) {
  const i18n = useI18n();
  const { t, day } = i18n;
  const records = task === undefined ? [] : [...task.done].sort((a, b) => a.seq - b.seq);

  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-task-id={row.taskId}
      data-next={row.nextDueOn ?? ''}
      data-overdue={row.overdue ? 'true' : 'false'}
      data-state={row.state}
      aria-label={row.title}
      className="flex flex-col gap-1 border-t border-stroke-subtle pt-3 first:border-t-0 first:pt-0"
      onKeyDown={(event) => {
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-body-lg font-semibold text-fg">{row.title}</h4>
        <StateChip
          testId="maintenance-state"
          tone={TASK_TONE[row.state]}
          icon={taskIcon(row.state)}
        >
          {t(AFTERCARE_TASK_STATE_KEYS[row.state] as MessageKey)}
        </StateChip>
      </div>
      <p className="text-body text-fg-secondary">{aftercareCoversText(i18n, row)}</p>
      <p data-testid="maintenance-cycle" className="text-body text-fg-secondary">
        {taskCycleText(i18n, row)}
      </p>
      <p
        data-testid="maintenance-next"
        className={row.overdue ? 'text-body font-semibold text-fg' : 'text-body text-fg'}
      >
        {taskDueText(i18n, row)}
      </p>
      {row.note !== null && <p className="text-body whitespace-pre-line text-fg">{row.note}</p>}
      {records.length > 0 && (
        <ol
          aria-label={t('aftercare.task.records', { name: row.title })}
          data-testid="maintenance-records"
          className="flex flex-col gap-0.5 border-l border-stroke-subtle pl-3"
        >
          {records.map((record) => (
            <li
              key={record.seq}
              data-done-seq={record.seq}
              className="text-caption text-fg-secondary"
            >
              {t('aftercare.task.record', { day: day(record.doneOn), author: record.authorName })}
              {record.note !== null && (
                <>
                  <span aria-hidden="true"> — </span>
                  {record.note}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {task !== undefined && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<CheckmarkCircle20Regular />}
            data-testid="maintenance-done"
            aria-label={t('aftercare.task.markDoneNamed', { name: row.title })}
            onClick={() => onDone(task)}
          >
            {t('aftercare.task.markDone')}
          </Button>
          <div className="flex items-center gap-1">
            <IconButton
              data-testid="maintenance-edit"
              icon={<Edit20Regular />}
              label={t('aftercare.editNamed', { name: row.title })}
              onClick={() => onEdit(task)}
            />
            <IconButton
              data-testid="maintenance-up"
              icon={<ArrowUp20Regular />}
              label={t('plan.move.up', { name: row.title })}
              onClick={() => onMove('up')}
            />
            <IconButton
              data-testid="maintenance-down"
              icon={<ArrowDown20Regular />}
              label={t('plan.move.down', { name: row.title })}
              onClick={() => onMove('down')}
            />
            {records.length === 0 && (
              <IconButton
                data-testid="maintenance-remove"
                icon={<Delete20Regular />}
                label={t('plan.removeNamed', { name: row.title })}
                onClick={() => onRemove(task)}
              />
            )}
          </div>
        </div>
      )}
      {task !== undefined && records.length > 0 && (
        <p data-testid="maintenance-remove-locked" className="text-caption text-fg-tertiary">
          {t('aftercare.task.locked')}
        </p>
      )}
    </li>
  );
}
