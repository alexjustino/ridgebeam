import { Copy20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { useSystemInfo } from '@/data/queries';
import { Mark } from '@/features/shell/Mark';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

// The credits are read from NOTICE itself rather than retyped here. Two lists of the same thing
// drift, and the one that drifts is always the one a person actually reads.
import notice from '../../../NOTICE?raw';

import { thirdParty } from './notice';

const REPOSITORY = 'https://github.com/alexjustino/ridgebeam';

/**
 * About.
 *
 * Not a version number in a corner. This is where the product says what it is and where its
 * name comes from, who made it, what it is licensed under, whose trademark the name is, that it
 * never reaches the network, and what it is built on — the least a piece of software owes the
 * person running it.
 */
export function AboutPage() {
  const { t, describeError, day } = useI18n();
  const system = useSystemInfo();
  const info = system.data ?? null;
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const credits = thirdParty(notice);

  const copyAddress = () => {
    // The address is copied, not opened. This product has no way to reach the network and does
    // not acquire one to show a link: the address is here to be read and taken elsewhere.
    navigator.clipboard.writeText(REPOSITORY).then(
      () => {
        setCopy('copied');
        window.setTimeout(() => setCopy('idle'), 2000);
      },
      () => setCopy('failed'),
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <header className="flex items-center gap-4">
        <Mark size={64} className="text-accent" />
        <div>
          <h1 className="text-title font-semibold text-fg">{t('about.title')}</h1>
          <p className="mt-1 text-body-lg text-fg-secondary">{t('about.lead')}</p>
        </div>
      </header>

      <Card title={t('about.name.title')}>
        <p className="text-body text-fg-secondary">{t('about.name.story')}</p>
      </Card>

      <Card title={t('about.build.title')} description={t('about.build.description')}>
        {system.isError ? (
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(system.error)}
          </InfoBar>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <Row label={t('about.build.version')} value={info?.version ?? '…'} />
            <Row label={t('about.build.commit')} value={__GIT_COMMIT__} mono />
            <Row label={t('about.build.date')} value={day(__BUILD_DATE__)} />
          </dl>
        )}
      </Card>

      <Card title={t('about.licence.title')}>
        <div className="flex flex-col gap-3 text-body text-fg-secondary">
          <p>{t('about.licence.author')}</p>
          <p>{t('about.licence.body')}</p>
          <p>{t('about.licence.trademark')}</p>
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('about.licence.repository')}
            </span>
            <span data-selectable className="font-mono text-caption break-all text-fg">
              {REPOSITORY}
            </span>
            <div className="pt-1">
              <Button icon={<Copy20Regular />} onClick={copyAddress}>
                {copy === 'copied' ? t('about.licence.copied') : t('about.licence.copy')}
              </Button>
            </div>
            {copy === 'failed' && (
              <span className="text-caption text-fg-secondary">
                {t('about.licence.copyFailed')}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('about.data.title')}>
        <div className="flex flex-col gap-2 text-body text-fg-secondary">
          <p>{t('about.data.body')}</p>
          {info !== null && (
            <>
              <p className="text-caption">{t('about.data.folder')}</p>
              <p className="font-mono text-caption break-all text-fg" data-selectable>
                {info.appDataDir}
              </p>
            </>
          )}
        </div>
      </Card>

      <Card title={t('about.credits.title')} description={t('about.credits.description')}>
        {!credits.found ? (
          <p className="text-body text-fg-secondary">{t('about.credits.unread')}</p>
        ) : credits.credits.length === 0 ? (
          <p className="text-body text-fg-secondary">{t('about.credits.none')}</p>
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-body">
            {credits.credits.map((credit) => (
              <Row key={credit.name} label={credit.name} value={credit.licence} />
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd
        data-selectable
        className={`min-w-0 break-all text-fg ${mono ? 'font-mono text-caption' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}
