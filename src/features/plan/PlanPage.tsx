import { ArrowExportLtr20Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { useSettings } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { DEFAULT_LENS, type LensChoice } from '@/domain/settings';
import { useI18n } from '@/i18n/useI18n';
import { ExportTemplateDialog } from '@/features/templates/ExportTemplateDialog';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';

import { Breakdown } from './Breakdown';
import { ByRoom } from './ByRoom';
import { ChangesTab } from './ChangesTab';
import { Checklist } from './Checklist';
import { GatesTab } from './GatesTab';
import { HandoverTab } from './HandoverTab';
import { PeopleTab } from './PeopleTab';
import { SnagsTab } from './SnagsTab';
import type { Outcome } from './outcome';

export type PlanTab =
  'breakdown' | 'by-room' | 'checklist' | 'gates' | 'people' | 'handover' | 'changes' | 'snags';

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
 *
 * The header offers **Export as a template…** (F9, `template-export`): the plan's shape written to a
 * file another work can start from, with its numbers stripped or kept (ADR-030).
 *
 * **Handover** (D3, decision 7) holds what the owner keeps when the work ends: the care notes of the
 * work, each room and each stage, and the hidden work — every check that needs its photo, with its
 * state — each leading to its item on the Gates tab.
 *
 * **Changes** (E1, decision 6) is the record of change orders once the plan is approved: each raised
 * with who asked, its price and its impact on the finish computed before anybody decides, and decided
 * once — approved, declined or withdrawn.
 *
 * **Snags** (E4, decision 5; pt "Pendências") is the list of what was found wrong or unfinished near
 * the end: each raised with where it is, who must fix it, its day and a photo, and closed once — fixed
 * with a photo of it fixed, or withdrawn with a reason.
 */
export function PlanPage({
  snapshot,
  calendarOpen,
  onCalendarOpen,
  initialFocus = null,
  onFocusTaken,
  initialTab = null,
  onTabTaken,
}: {
  snapshot: WorkSnapshot;
  calendarOpen: boolean;
  onCalendarOpen: (open: boolean) => void;
  /** A row to open the breakdown on, focused — asked for from another page. */
  initialFocus?: string | null;
  onFocusTaken?: () => void;
  /** A tab to open on — asked for from another page (E1: the dashboard's Changes card). */
  initialTab?: PlanTab | null;
  onTabTaken?: () => void;
}) {
  const { t, describeError } = useI18n();
  const term = useTerms();
  const settings = useSettings();
  const lens = settings.data?.lens ?? DEFAULT_LENS;
  const [tab, setTab] = useState<PlanTab>(() =>
    initialTab !== null ? initialTab : initialFocus === null ? TAB_FOR_LENS[lens] : 'breakdown',
  );
  const [focusRow, setFocusRow] = useState<string | null>(initialFocus);
  const [focusCheck, setFocusCheck] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const panel = useId();

  // The row another page asked for is taken once, on arrival; the request is then let go, so the
  // next visit to the plan opens on the lens's own arrangement.
  useEffect(() => {
    if (initialFocus !== null) onFocusTaken?.();
  }, [initialFocus, onFocusTaken]);
  useEffect(() => {
    if (initialTab !== null) onTabTaken?.();
  }, [initialTab, onTabTaken]);

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
  const gates = useCallback((checkId: string) => {
    setTab('gates');
    setFocusCheck(checkId);
  }, []);
  const checkFocused = useCallback(() => setFocusCheck(null), []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-fg">{t('nav.plan')}</h1>
          <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
          <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('plan.lead')}</p>
        </div>
        <Button
          icon={<ArrowExportLtr20Regular />}
          data-testid="template-export"
          className="shrink-0"
          onClick={() => setExporting(true)}
        >
          {t('templates.export', { template: term('template') })}
        </Button>
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
            { id: 'gates', label: t('plan.tab.gates') },
            { id: 'people', label: t('plan.tab.people') },
            { id: 'handover', label: t('plan.tab.handover') },
            { id: 'changes', label: t('plan.tab.changes') },
            { id: 'snags', label: t('plan.tab.snags') },
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
        {tab === 'gates' && (
          <GatesTab snapshot={snapshot} focusCheck={focusCheck} onFocused={checkFocused} />
        )}
        {tab === 'people' && <PeopleTab snapshot={snapshot} />}
        {tab === 'handover' && <HandoverTab snapshot={snapshot} onGates={gates} />}
        {tab === 'changes' && <ChangesTab snapshot={snapshot} />}
        {tab === 'snags' && <SnagsTab snapshot={snapshot} />}
      </div>

      {/* Mounted only while open, so each opening starts from the plan as it is now. */}
      {exporting && (
        <ExportTemplateDialog snapshot={snapshot} open onClose={() => setExporting(false)} />
      )}
    </div>
  );
}
