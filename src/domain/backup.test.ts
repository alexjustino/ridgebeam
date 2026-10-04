import { describe, expect, it } from 'vitest';

import { activity, decision, entry, snapshot, stage } from './__fixtures__/plan';
import { BACKUP_STALE_DAYS, backupDue, workChanges, type BackupFacts } from './backup';
import type {
  Baseline,
  CareNote,
  ChangeOrder,
  ChangeOrderDecision,
  CheckAnswer,
  Document,
  Payment,
  Replanning,
} from './plan';

const TODAY = '2026-10-02';

const due = (parts: Partial<BackupFacts>) =>
  backupDue({
    lastBackupAt: null,
    lastChangeAt: null,
    today: TODAY,
    hasContent: true,
    ...parts,
  });

describe('the backup reminder', () => {
  it('waits seven calendar days', () => {
    expect(BACKUP_STALE_DAYS).toBe(7);
  });

  it('says never when there is no backup and the work has something in it', () => {
    expect(due({})).toEqual({ kind: 'never', days: null });
    expect(due({ lastChangeAt: '2026-10-01T12:00:00.000Z' })).toEqual({
      kind: 'never',
      days: null,
    });
  });

  it('says nothing of an empty work never backed up', () => {
    expect(due({ hasContent: false })).toBeNull();
    expect(due({ hasContent: false, lastChangeAt: '2026-10-01T12:00:00.000Z' })).toBeNull();
  });

  it('is not stale at exactly seven days, and is at eight, counting whole calendar days', () => {
    const changed = '2026-09-30T12:00:00.000Z';
    expect(due({ lastBackupAt: '2026-09-25', lastChangeAt: changed })).toBeNull();
    expect(due({ lastBackupAt: '2026-09-24', lastChangeAt: changed })).toEqual({
      kind: 'stale',
      days: 8,
    });
    expect(due({ lastBackupAt: '2026-08-02', lastChangeAt: changed })).toEqual({
      kind: 'stale',
      days: 61,
    });
  });

  it('says nothing of an old backup when nothing changed after its day', () => {
    expect(due({ lastBackupAt: '2026-09-01', lastChangeAt: null })).toBeNull();
    expect(
      due({ lastBackupAt: '2026-09-01', lastChangeAt: '2026-08-31T23:00:00.000Z' }),
    ).toBeNull();
    // A change on the backup's own day is taken as backed up.
    expect(
      due({ lastBackupAt: '2026-09-01', lastChangeAt: '2026-09-01T20:00:00.000Z' }),
    ).toBeNull();
    expect(due({ lastBackupAt: '2026-09-01', lastChangeAt: '2026-09-02T08:00:00.000Z' })).toEqual({
      kind: 'stale',
      days: 31,
    });
    // A day is as good as a timestamp.
    expect(due({ lastBackupAt: '2026-09-01', lastChangeAt: '2026-09-02' })).toMatchObject({
      kind: 'stale',
    });
  });

  it('does not ask whether an old backup’s work has content: a change means it has', () => {
    expect(
      due({ lastBackupAt: '2026-09-01', lastChangeAt: '2026-09-20', hasContent: false }),
    ).toMatchObject({ kind: 'stale' });
  });

  it('says nothing when a day is not a day, or the backup is dated after today; never throws', () => {
    expect(due({ today: 'soon' })).toBeNull();
    expect(due({ lastBackupAt: '2026-02-30', lastChangeAt: '2026-09-20' })).toBeNull();
    expect(due({ lastBackupAt: '2026-10-20', lastChangeAt: '2026-10-21' })).toBeNull();
    expect(due({ lastBackupAt: '2026-09-01', lastChangeAt: 'whenever' })).toBeNull();
  });
});

describe('what the work records as changes', () => {
  const at = (day: string) => `${day}T12:00:00.000Z`;

  it('has no content when it has neither an entry nor an activity', () => {
    expect(workChanges(snapshot(), [])).toEqual({
      lastChangeAt: '2026-08-20T12:00:00.000Z',
      hasContent: false,
    });
    expect(workChanges(snapshot({ activities: [activity('a', 's', 1, 1)] }), []).hasContent).toBe(
      true,
    );
    expect(workChanges(snapshot(), [entry(1, '2026-09-01')]).hasContent).toBe(true);
  });

  it('takes the latest diary entry written', () => {
    const entries = [entry(1, '2026-09-03'), entry(2, '2026-09-01')];
    expect(workChanges(snapshot(), entries).lastChangeAt).toBe('2026-09-03T18:00:00.000Z');
  });

  it.each<[string, Parameters<typeof snapshot>[0]]>([
    ['the plan approved', { work: { ...snapshot().work, approvedAt: at('2026-09-10') } }],
    [
      'a stage started or closed',
      {
        stages: [{ ...stage('s', 1), startedAt: at('2026-09-02'), closedAt: at('2026-09-10') }],
      },
    ],
    ['a decision made', { decisions: [decision('d', 's', 1, 0, at('2026-09-10'))] }],
    ['a payment', { payments: [{ createdAt: at('2026-09-10') } as Payment] }],
    ['a check answered', { checkAnswers: [{ answeredAt: at('2026-09-10') } as CheckAnswer] }],
    ['a document added', { documents: [{ createdAt: at('2026-09-10') } as Document] }],
    ['a care note', { careNotes: [{ createdAt: at('2026-09-10') } as CareNote] }],
    [
      'a change order raised',
      { changeOrders: [{ createdAt: at('2026-09-10'), decision: null } as ChangeOrder] },
    ],
    [
      'a change order decided',
      {
        changeOrders: [
          {
            createdAt: at('2026-09-04'),
            decision: { createdAt: at('2026-09-10') } as ChangeOrderDecision,
          } as ChangeOrder,
        ],
      },
    ],
    ['a baseline taken', { baselines: [{ takenAt: at('2026-09-10') } as Baseline] }],
    ['a replanning opened', { replanning: { openedAt: at('2026-09-10') } as Replanning }],
  ])('counts %s', (_, parts) => {
    const entries = [entry(1, '2026-09-05')];
    expect(workChanges(snapshot(parts), entries).lastChangeAt).toBe(at('2026-09-10'));
  });
});
