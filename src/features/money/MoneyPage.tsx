import { useId, useMemo, useState } from 'react';

import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';

import { ByStage } from './ByStage';
import { ByTrade } from './ByTrade';
import { Ledger } from './Ledger';
import { SCurveChart } from './SCurveChart';

type MoneyTab = 'by-stage' | 'by-trade' | 'ledger';

/**
 * Money (slice F6): three facts from three sources — planned from cost lines, committed from the
 * quotes and contracts accepted, paid from the ledger — every figure opening onto its rows, in the
 * work's currency and in whole cents until the moment it becomes words (ADR-023, ADR-024). Three
 * arrangements of the same money: by stage, by trade, and the ledger itself; the S-curve of planned
 * against paid under them.
 */
export function MoneyPage({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, describeError } = useI18n();
  const panel = useId();
  const [tab, setTab] = useState<MoneyTab>('by-stage');
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
          ]}
        />
      </div>

      <div
        role="tabpanel"
        id={panel}
        aria-labelledby={`${panel}-tab-${tab}`}
        className="flex flex-col gap-4"
      >
        {tab === 'by-stage' && <ByStage snapshot={snapshot} outcome={outcome} />}
        {tab === 'by-trade' && <ByTrade snapshot={snapshot} />}
        {tab === 'ledger' && <Ledger snapshot={snapshot} />}
      </div>

      <SCurveChart snapshot={snapshot} />
    </div>
  );
}
