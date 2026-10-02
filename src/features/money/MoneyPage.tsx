import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';

import { ByStage } from './ByStage';
import { ByTrade } from './ByTrade';
import { Funding } from './Funding';
import { Ledger } from './Ledger';
import { RunwayCard } from './RunwayCard';
import { SCurveChart } from './SCurveChart';

type MoneyTab = 'by-stage' | 'by-trade' | 'ledger' | 'funding';

/**
 * Money (slice F6): three facts from three sources — planned from cost lines, committed from the
 * quotes and contracts accepted, paid from the ledger — every figure opening onto its rows, in the
 * work's currency and in whole cents until the moment it becomes words (ADR-023, ADR-024). Three
 * arrangements of the same money: by stage, by trade, and the ledger itself; the S-curve of planned
 * against paid under them.
 *
 * Slice E2 adds the fourth tab, **Funding** — where the money comes from and what has arrived — and,
 * above the tabs, **Will the money last?**: the week-by-week projection of what comes in against what
 * goes out, said in one sentence before anything else on the page.
 *
 * Asked for from another page (D2: the Next question's "How is this commitment to be paid?"), it
 * opens By stage on that commitment's payment plan, open and focused; the request is then let go,
 * so the next visit opens as usual.
 */
export function MoneyPage({
  snapshot,
  initialCommitment = null,
  onFocusTaken,
}: {
  snapshot: WorkSnapshot;
  /** A commitment whose payment plan to open on, focused — asked for from another page. */
  initialCommitment?: string | null;
  onFocusTaken?: () => void;
}) {
  const { t, describeError } = useI18n();
  const term = useTerms();
  const panel = useId();
  const [tab, setTab] = useState<MoneyTab>('by-stage');
  // Held here until By stage has put the focus on it, then let go: coming back to the tab later
  // opens as usual.
  const [focusCommitment, setFocusCommitment] = useState<string | null>(initialCommitment);
  const focusTaken = useCallback(() => setFocusCommitment(null), []);

  useEffect(() => {
    if (initialCommitment !== null) onFocusTaken?.();
  }, [initialCommitment, onFocusTaken]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const outcome = useMemo(
    () => ({
      kept: () => setRefusal(null),
      refused: (error: unknown) => setRefusal(describeError(error)),
    }),
    [describeError],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.money')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('money.lead')}</p>
      </header>

      {refusal !== null && (
        <InfoBar severity="danger" title={t('money.refused')}>
          {refusal}
        </InfoBar>
      )}

      <RunwayCard snapshot={snapshot} />

      <div data-testid="money-tabs">
        <TabStrip
          label={t('money.tabs')}
          panelId={panel}
          active={tab}
          onSelect={(id) => setTab(id as MoneyTab)}
          tabs={[
            { id: 'by-stage', label: t('money.tab.byStage') },
            { id: 'by-trade', label: t('money.tab.byTrade') },
            { id: 'ledger', label: t('money.tab.ledger') },
            { id: 'funding', label: term('funding', { capital: true }) },
          ]}
        />
      </div>

      <div
        role="tabpanel"
        id={panel}
        aria-labelledby={`${panel}-tab-${tab}`}
        className="flex flex-col gap-4"
      >
        {tab === 'by-stage' && (
          <ByStage
            snapshot={snapshot}
            outcome={outcome}
            focusCommitment={focusCommitment}
            onFocusTaken={focusTaken}
          />
        )}
        {tab === 'by-trade' && <ByTrade snapshot={snapshot} />}
        {tab === 'ledger' && <Ledger snapshot={snapshot} />}
        {tab === 'funding' && <Funding snapshot={snapshot} outcome={outcome} />}
      </div>

      <SCurveChart snapshot={snapshot} />
    </div>
  );
}
