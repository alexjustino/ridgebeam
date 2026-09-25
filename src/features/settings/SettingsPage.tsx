import type { SettingKey, Settings } from '@/data/commands';
import { useSetSetting, useSettings } from '@/data/queries';
import {
  LANGUAGES,
  LENSES,
  THEMES,
  type LanguageChoice,
  type LensChoice,
  type ThemeChoice,
} from '@/domain/settings';
import type { MessageKey } from '@/i18n/en';
import { LANGUAGE_AUTONYMS } from '@/i18n/index';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Card } from '@/ui/Card';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';

const THEME_KEYS: Record<ThemeChoice, MessageKey> = {
  system: 'settings.theme.system',
  light: 'settings.theme.light',
  dark: 'settings.theme.dark',
};

const LENS_KEYS: Record<LensChoice, MessageKey> = {
  owner: 'settings.lens.owner',
  architect: 'settings.lens.architect',
  engineer: 'settings.lens.engineer',
};

/**
 * Settings: how the application looks, which language it speaks, and which lens it will show a
 * work through.
 *
 * Each choice is one press, kept at once in the application's own database — there is no Save
 * button to forget. The choice shows before the host has answered (the theme changes, the words
 * change), and a choice the host refused goes back to what it was, with the host's sentence
 * under the card that asked (DESIGN_SYSTEM §8, the Defaults card).
 */
export function SettingsPage({ settings }: { settings: Settings }) {
  const { t, describeError } = useI18n();
  const read = useSettings();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.settings')}</h1>
        <p className="mt-1 text-body text-fg-secondary">{t('settings.lead')}</p>
      </header>

      {/* A table that could not be read is not a person with no preferences: the built-in
          choices stand, and the screen says so rather than presenting them as somebody's. */}
      {read.isError && (
        <InfoBar severity="caution" title={t('settings.unread')}>
          {describeError(read.error)}
        </InfoBar>
      )}

      <AppearanceCard theme={settings.theme} />
      <LanguageCard language={settings.language} />
      <LensCard lens={settings.lens} />
    </div>
  );
}

/** One choice kept, and the refusal beside it when there is one. */
function useChoice(key: SettingKey) {
  const { describeError } = useI18n();
  const set = useSetSetting();
  return {
    choose: (value: string, said: string) => {
      set.mutate({ key, value });
      announce(said);
    },
    problem: set.isError ? describeError(set.error) : null,
  };
}

function Refusal({ problem }: { problem: string | null }) {
  const { t } = useI18n();
  if (problem === null) return null;
  return (
    <div className="mt-3">
      <InfoBar severity="caution" title={t('settings.refused')}>
        {problem}
      </InfoBar>
    </div>
  );
}

function AppearanceCard({ theme }: { theme: ThemeChoice }) {
  const { t } = useI18n();
  const { choose, problem } = useChoice('theme');
  const labels = Object.fromEntries(THEMES.map((each) => [each, t(THEME_KEYS[each])])) as Record<
    ThemeChoice,
    string
  >;

  return (
    <Card title={t('settings.appearance.title')} description={t('settings.appearance.description')}>
      <ChoiceGroup
        label={t('settings.theme')}
        options={THEMES}
        value={theme}
        labels={labels}
        onChange={(next: ThemeChoice) => choose(next, labels[next])}
      />
      <Refusal problem={problem} />
    </Card>
  );
}

function LanguageCard({ language }: { language: LanguageChoice }) {
  const { t, language: showing } = useI18n();
  const { choose, problem } = useChoice('language');
  // Each language is named in itself, in every language (`LANGUAGE_AUTONYMS`); only the
  // "follow Windows" choice is a sentence, and so it is translated.
  const labels: Record<LanguageChoice, string> = {
    system: t('settings.language.system'),
    ...LANGUAGE_AUTONYMS,
  };

  return (
    <Card title={t('settings.language.title')} description={t('settings.language.description')}>
      <ChoiceGroup
        label={t('settings.language')}
        options={LANGUAGES}
        value={language}
        labels={labels}
        onChange={(next: LanguageChoice) => choose(next, labels[next])}
      />
      <p className="mt-3 text-caption text-fg-tertiary">
        {t('settings.language.showing', { language: LANGUAGE_AUTONYMS[showing] })}
      </p>
      <Refusal problem={problem} />
    </Card>
  );
}

function LensCard({ lens }: { lens: LensChoice }) {
  const { t } = useI18n();
  const { choose, problem } = useChoice('lens');
  const labels = Object.fromEntries(LENSES.map((each) => [each, t(LENS_KEYS[each])])) as Record<
    LensChoice,
    string
  >;

  return (
    <Card title={t('settings.lens.title')} description={t('settings.lens.description')}>
      <ChoiceGroup
        label={t('settings.lens')}
        options={LENSES}
        value={lens}
        labels={labels}
        onChange={(next: LensChoice) => choose(next, labels[next])}
      />
      <p className="mt-3 text-caption text-fg-tertiary">{t('settings.lens.note')}</p>
      <Refusal problem={problem} />
    </Card>
  );
}
