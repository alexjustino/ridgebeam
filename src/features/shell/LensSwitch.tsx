import { useSetSetting, useSettings } from '@/data/queries';
import { DEFAULT_LENS, LENSES, type LensChoice } from '@/domain/settings';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { ChoiceGroup } from '@/ui/ChoiceGroup';

import { LENS_KEYS } from './lenses';

/**
 * The lens, one press away, in the title bar — owner first (ADR-014).
 *
 * A lens is a vocabulary and an arrangement over the same rows: pressing one changes the words on
 * every screen and writes the person's `lens` setting, and nothing else. The work's database has
 * no lens in it and never will, so switching can never change a plan. Settings offers the same
 * choice; both write the one setting, so the two can never disagree.
 */
export function LensSwitch() {
  const { t } = useI18n();
  const settings = useSettings();
  const set = useSetSetting();
  const lens = settings.data?.lens ?? DEFAULT_LENS;
  const labels = Object.fromEntries(LENSES.map((each) => [each, t(LENS_KEYS[each])])) as Record<
    LensChoice,
    string
  >;

  return (
    <div data-testid="lens-switch" className="flex items-center">
      <ChoiceGroup
        compact
        label={t('settings.lens')}
        options={LENSES}
        value={lens}
        labels={labels}
        onChange={(next: LensChoice) => {
          set.mutate({ key: 'lens', value: next });
          announce(t('shell.lensChosen', { lens: labels[next] }));
        }}
      />
    </div>
  );
}
