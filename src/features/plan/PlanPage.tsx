import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { useSettings } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { DEFAULT_LENS, type LensChoice } from '@/domain/settings';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';

import { Breakdown } from './Breakdown';
import { ByRoom } from './ByRoom';
import { Checklist } from './Checklist';
import type { Outcome } from './outcome';

export type PlanTab = 'breakdown' | 'by-room' | 'checklist';

/**
 * The arrangement each lens opens on (ADR-014): the engineer's work breakdown, the architect's
 * works by room, the owner's checklist. Only the first one — the person moves between them freely,
 * and switching the lens while the page is open changes its words, not where the person is.
 */
const TAB_FOR_LENS: Record<LensChoice, PlanTab> = {
  engineer: 'breakdown',
  architect: 'by-room',
  owner: 'checklist',
};

/**
 * The plan: three arrangements of the same rows (SPEC §2.13, DESIGN_SYSTEM §8).
 *
 * What a person writes here is intent — names, durations in working days, responsibles, rooms,
 * quantities, the order of things, the calendar. There is deliberately nothing here that records
 * how far along anything is: that is the diary's to say (SPEC §2.6). Editing lives in the
 * breakdown; the other two arrangements show the same rows and lead back to it. Every change is
 * kept the moment it is made, the host answers with the whole plan, and every arrangement shows
 * that answer — so they can never disagree.
 */
export function PlanPage({
  snapshot,
  calendarOpen,
  onCalendarOpen,
  initialFocus = null,
  onFocusTaken,
}: {
  snapshot: WorkSnapshot;
  calendarOpen: boolean;
  onCalendarOpen: (open: boolean) => void;
  /** A row to open the breakdown on, focused — asked for from another page. */
  initialFocus?: string | null;
  onFocusTaken?: () => void;
}) {
  const { t, describeError } = useI18n();
  const term = useTerms();
  const settings = useSettings();
  const lens = settings.data?.lens ?? DEFAULT_LENS;
  const [tab, setTab] = useState<PlanTab>(() =>
    initialFocus === null ? TAB_FOR_LENS[lens] : 'breakdown',
  );
  const [focusRow, setFocusRow] = useState<string | null>(initialFocus);
  const [refusal, setRefusal] = useState<string | null>(null);
  const panel = useId();

  // The row another page asked for is taken once, on arrival; the request is then let go, so the
  // next visit to the plan opens on the lens's own arrangement.
  useEffect(() => {
    if (initialFocus !== null) onFocusTaken?.();
  }, [initialFocus, onFocusTaken]);

  const outcome: Outcome = useMemo(
    () => ({
      refused: (error: unknown) => setRefusal(describeError(error)),
      kept: () => setRefusal(null),
    }),
    [describeError],
  );
  const edit = useCallback((activityId: string) => {
    setTab('breakdown');
    setFocusRow(activityId);
  }, []);
  const focused = useCallback(() => setFocusRow(null), []);

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

      <div data-testid="plan-tabs">
        <TabStrip
          label={t('plan.tabs')}
          panelId={panel}
          active={tab}
          onSelect={(id) => setTab(id as PlanTab)}
          tabs={[
            { id: 'breakdown', label: t('plan.tab.breakdown') },
            { id: 'by-room', label: t('plan.tab.byRoom', { room: term('room') }) },
            { id: 'checklist', label: t('plan.tab.checklist') },
          ]}
        />
      </div>

      <div
        role="tabpanel"
        id={panel}
        aria-labelledby={`${panel}-tab-${tab}`}
        className="flex flex-col gap-4"
      >
        {tab === 'breakdown' && (
          <Breakdown
            snapshot={snapshot}
            outcome={outcome}
            calendarOpen={calendarOpen}
            onCalendarOpen={onCalendarOpen}
            focusRow={focusRow}
            onFocused={focused}
          />
        )}
        {tab === 'by-room' && <ByRoom snapshot={snapshot} onEdit={edit} />}
        {tab === 'checklist' && <Checklist snapshot={snapshot} onEdit={edit} />}
      </div>
    </div>
  );
}
