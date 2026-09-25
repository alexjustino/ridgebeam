import { useMemo } from 'react';

import { useDiary } from '@/data/queries';
import {
  correctedBy,
  daysWithoutEntry,
  daysWithoutEntryFigure,
  doneFigure,
  lostDays,
  lostDaysFigure,
  progress,
  thisWeek,
  type DoneRow,
} from '@/domain/diary';
import { workingCalendarOf, type WorkSnapshot } from '@/domain/plan';
import { EntryView } from '@/features/diary/DiaryPage';
import { useI18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

/**
 * What the diary says, on the front door (slice F4): what is done, the working days with nothing
 * written (SPEC R2 — a plan drifts from the site on exactly those days), the days weather took,
 * this week on site, and the last entries with their photos. Every figure is the domain's, derived
 * from the diary's effective entries — corrections applied — and opens onto its rows.
 */
export function SiteCard({ snapshot, today }: { snapshot: WorkSnapshot; today: string }) {
  const { t, tp, day, number, describeError } = useI18n();
  const diary = useDiary(true);
  const entries = useMemo(() => diary.data ?? [], [diary.data]);
  const progressById = useMemo(() => progress(snapshot, entries), [snapshot, entries]);
  const calendar = workingCalendarOf(snapshot);

  if (diary.isError) {
    return (
      <InfoBar severity="danger" title={t('common.hostSilent')}>
        {describeError(diary.error)}
      </InfoBar>
    );
  }

  const states = [...progressById.values()].map((row) => row.state);
  const done = doneFigure(snapshot, progressById);
  const missingDays = daysWithoutEntryFigure(
    calendar === null ? [] : daysWithoutEntry(calendar, today, snapshot.work.startDate, entries),
  );
  const lost = lostDaysFigure(lostDays(entries));
  const week = thisWeek(entries, today);
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const last = [...entries].sort((a, b) => b.seq - a.seq).slice(0, 3);
  const corrected = correctedBy(entries);

  return (
    <>
      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <FigureRow<DoneRow>
              testId="done"
              size="title"
              figure={done}
              label={t('diary.figure.finished')}
              value={t('dashboard.done.value', {
                finished: number(done.value),
                total: number(states.length),
              })}
              rowsLabel={t('dashboard.done.rows')}
              renderRow={(row) => (
                <>
                  <span className="font-semibold text-fg">{row.title}</span>
                  <span aria-hidden="true"> — </span>
                  <span>{t('state.finished', { day: day(row.finishedOn ?? '') })}</span>
                </>
              )}
            />
            <p className="mt-1 text-caption text-fg-tertiary">
              {t('dashboard.done.caption', {
                started: number(states.filter((state) => state === 'started').length),
                notStarted: number(states.filter((state) => state === 'not-started').length),
              })}
            </p>
          </div>
          <div>
            <FigureRow
              testId="days-without-entry"
              size="title"
              figure={missingDays}
              label={t('diary.figure.daysWithoutEntry')}
              value={number(missingDays.value)}
              rowsLabel={t('dashboard.days.rows')}
              renderRow={(row) => <span>{day(row.day ?? '')}</span>}
            />
            <p className="mt-1 text-caption text-fg-tertiary">{t('dashboard.noEntry.hint')}</p>
          </div>
          <div>
            <FigureRow
              testId="lost-days"
              size="title"
              figure={lost}
              label={t('diary.figure.lostDays')}
              value={number(lost.value)}
              rowsLabel={t('dashboard.days.rows')}
              renderRow={(row) => <span>{day(row.day ?? '')}</span>}
            />
            <p className="mt-1 text-caption text-fg-tertiary">{t('dashboard.lost.hint')}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('dashboard.week.title')}>
          <div data-testid="this-week" className="flex flex-col gap-1 text-body text-fg">
            <p>
              {week.days.length === 0
                ? t('dashboard.week.none')
                : tp('dashboard.week.days', week.days.length)}
            </p>
            <p className="text-fg-secondary">
              {week.people.length === 0
                ? t('dashboard.week.nobody')
                : t('dashboard.week.people', {
                    names: week.people.map((id) => people.get(id) ?? '?').join(', '),
                  })}
            </p>
          </div>
        </Card>
        <Card title={t('dashboard.last.title')}>
          <div data-testid="last-entries">
            {last.length === 0 ? (
              <p className="text-body text-fg-tertiary">{t('dashboard.last.none')}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {last.map((entry) => (
                  <EntryView
                    key={entry.seq}
                    entry={entry}
                    snapshot={snapshot}
                    correctedBySeq={corrected.get(entry.seq) ?? null}
                  />
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
