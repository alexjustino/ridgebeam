import { Edit20Regular } from '@fluentui/react-icons';
import { useId, useMemo, useState } from 'react';

import { useToday } from '@/app/today';
import { useDiary } from '@/data/queries';
import { correctedBy, entriesByDay, type DiaryEntry } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';

import { EntryForm } from './EntryForm';
import { PhotoThumb } from './PhotoThumb';
import { WEATHER_KEYS } from './weather';

/**
 * The diary (slice F4): what actually happened, day by day.
 *
 * The form on top writes one entry — one press on an ordinary day. Below, every day that has an
 * entry, newest first, each entry with who wrote it and when, what was done, who was there, the
 * weather and its photos. An entry is never edited (ADR-019): where an edit would be expected
 * there is "Correct…", which opens the form as a correction of that entry; the original stays,
 * struck through, and says which entry corrected it. The diary is read on its own, not with the
 * plan, and every entry written reads it again.
 */
export function DiaryPage({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, describeError } = useI18n();
  const today = useToday();
  const diary = useDiary(true);
  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);
  const [correcting, setCorrecting] = useState<DiaryEntry | null>(null);
  const entries = diary.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.diary')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('diary.lead')}</p>
      </header>

      {diary.isError ? (
        <InfoBar severity="danger" title={t('common.hostSilent')}>
          {describeError(diary.error)}
        </InfoBar>
      ) : diary.isPending ? (
        <div className="h-48 rounded-xl bg-card-hover" />
      ) : (
        <>
          <EntryForm
            key={correcting === null ? 'new' : `correct-${correcting.seq}`}
            snapshot={snapshot}
            scheduled={scheduled}
            entries={entries}
            today={today}
            correcting={correcting}
            onDone={() => setCorrecting(null)}
          />
          <DayView
            snapshot={snapshot}
            entries={entries}
            onCorrect={(entry) => {
              setCorrecting(entry);
              window.scrollTo?.({ top: 0 });
              document.querySelector('main')?.scrollTo({ top: 0 });
            }}
          />
        </>
      )}
    </div>
  );
}

function DayView({
  snapshot,
  entries,
  onCorrect,
}: {
  snapshot: WorkSnapshot;
  entries: readonly DiaryEntry[];
  onCorrect: (entry: DiaryEntry) => void;
}) {
  const { t, day } = useI18n();
  const heading = useId();
  const days = entriesByDay(entries);
  const corrected = correctedBy(entries);

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-3">
      <h2 id={heading} className="text-subtitle font-semibold text-fg">
        {t('diary.days.title')}
      </h2>
      <p className="text-caption text-fg-tertiary">{t('diary.chain.note')}</p>
      {days.length === 0 ? (
        <Card>
          <EmptyState title={t('diary.empty.title')} description={t('diary.empty.description')} />
        </Card>
      ) : (
        days.map((group) => (
          <section
            key={group.day}
            data-diary-day={group.day}
            aria-label={day(group.day)}
            className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
          >
            <h3 className="mb-2 text-body-lg font-semibold text-fg">{day(group.day)}</h3>
            <ol className="flex flex-col gap-3">
              {group.entries.map((entry) => (
                <EntryView
                  key={entry.seq}
                  entry={entry}
                  snapshot={snapshot}
                  correctedBySeq={corrected.get(entry.seq) ?? null}
                  onCorrect={() => onCorrect(entry)}
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  );
}

/** One entry as the diary keeps it — every fact it states, and nothing it does not. */
export function EntryView({
  entry,
  snapshot,
  correctedBySeq,
  onCorrect,
}: {
  entry: DiaryEntry;
  snapshot: WorkSnapshot;
  correctedBySeq: number | null;
  /** Absent where an entry is only shown, as on the dashboard. */
  onCorrect?: () => void;
}) {
  const { t, instant, number } = useI18n();
  const why = useId();
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const struck = correctedBySeq !== null;
  const facts: string[] = [
    ...entry.done.map((line) => {
      const activity = activities.get(line.activityId);
      const name = activity?.name ?? t('diary.entry.unknownActivity');
      const said = t(line.state === 'finished' ? 'diary.entry.finished' : 'diary.entry.worked', {
        name,
      });
      return line.quantity === null
        ? said
        : `${said} · ${[number(line.quantity), activity?.unit ?? ''].join(' ').trim()}`;
    }),
    ...(entry.present.length > 0
      ? [
          t('diary.entry.present', {
            names: entry.present.map((id) => people.get(id) ?? '?').join(', '),
          }),
        ]
      : []),
    ...(entry.weather !== null
      ? [t('diary.entry.weather', { weather: t(WEATHER_KEYS[entry.weather]) })]
      : []),
    ...(entry.lostDay ? [t('diary.entry.lostDay')] : []),
    ...(entry.hours !== null ? [t('diary.entry.hours', { hours: number(entry.hours) })] : []),
    ...(entry.deliveries !== null ? [t('diary.entry.deliveries', { text: entry.deliveries })] : []),
    ...(entry.incidents !== null ? [t('diary.entry.incidents', { text: entry.incidents })] : []),
    ...(entry.visitors !== null ? [t('diary.entry.visitors', { text: entry.visitors })] : []),
  ];

  return (
    <li
      data-entry-seq={entry.seq}
      {...(struck ? { 'data-corrected-by': String(correctedBySeq) } : {})}
      className="flex flex-col gap-1.5 border-t border-stroke-subtle pt-3 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('diary.entry.header', {
            seq: entry.seq,
            author: entry.authorName,
            time: instant(entry.createdAt),
          })}
        </span>
        {entry.kind === 'correction' && entry.correctsSeq !== null && (
          <span className="rounded-md bg-info-subtle px-2 py-0.5 text-caption text-fg">
            {t('diary.entry.correction', { seq: entry.correctsSeq })}
          </span>
        )}
        {struck && (
          <span className="rounded-md bg-caution-subtle px-2 py-0.5 text-caption text-fg">
            {t('diary.entry.correctedBy', { seq: correctedBySeq })}
          </span>
        )}
      </div>
      <div className={struck ? 'text-fg-tertiary line-through' : 'text-fg'}>
        {entry.note !== null && <p className="text-body whitespace-pre-line">{entry.note}</p>}
        {facts.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-body">
            {facts.map((fact, index) => (
              <li key={index}>{fact}</li>
            ))}
          </ul>
        )}
      </div>
      {entry.photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {entry.photos.map((photo) => (
            <li key={photo.fileHash}>
              <PhotoThumb photo={photo} day={entry.day} />
            </li>
          ))}
        </ul>
      )}
      {onCorrect !== undefined && (
        <div className="flex items-center gap-2">
          <Button
            appearance="subtle"
            icon={<Edit20Regular />}
            data-testid="entry-correct"
            aria-describedby={why}
            onClick={onCorrect}
          >
            {t('diary.correct')}
          </Button>
          <span id={why} className="text-caption text-fg-tertiary">
            {t('diary.correct.why')}
          </span>
        </div>
      )}
    </li>
  );
}
