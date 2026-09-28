import { ArrowRight16Regular } from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useNavigation } from '@/app/navigation';
import { useDiary } from '@/data/queries';
import {
  lastEntriesFigure,
  onSiteFigure,
  peopleExpectedFigure,
  weatherLostFigure,
  weekDays,
  weekDaysWithoutEntryFigure,
  weekEntriesFigure,
  weekOf,
  DASHBOARD_LABEL_KEYS,
  type EntryRow,
  type ExpectedRow,
  type PersonRow,
  type WeatherLostRow,
} from '@/domain/dashboard';
import {
  correctedBy,
  daysWithoutEntry,
  daysWithoutEntryFigure,
  doneFigure,
  lostDays,
  lostDaysFigure,
  progress,
  type DoneRow,
} from '@/domain/diary';
import { workingCalendarOf, type WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import { EntryView } from '@/features/diary/DiaryPage';
import { shortened } from '@/features/reports/compose/document';
import { WEATHER_KEYS } from '@/features/reports/compose/words';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

/** How much of a note a row of this week's entries shows; the entry below shows it whole. */
const NOTE_IN_ROW = 120;

/**
 * What the diary says, on the front door (slices F4 and F10): what is done, the working days with
 * nothing written (SPEC R2 — a plan drifts from the site on exactly those days), the days lost and
 * the days weather took; this week on site, Monday to Sunday — the entries, the working days with
 * none, who was there and who is expected; and the last entries with their photos, each opening the
 * diary at itself. Every figure is the domain's — the same the weekly report prints — derived from
 * the diary's effective entries, corrections applied, and opens onto its rows.
 */
export function SiteCard({
  snapshot,
  scheduled,
  today,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  today: string;
}) {
  const { t, tp, day, number, describeError } = useI18n();
  const navigation = useNavigation();
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
  const weather = weatherLostFigure(entries);
  const week = weekOf(today);
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity.name]));
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const last = lastEntriesFigure(entries);
  const bySeq = new Map(entries.map((entry) => [entry.seq, entry]));
  const corrected = correctedBy(entries);

  return (
    <>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <div>
            <FigureRow<WeatherLostRow>
              testId="weather-lost"
              size="title"
              figure={weather}
              label={t(DASHBOARD_LABEL_KEYS.weatherLost)}
              value={number(weather.value)}
              rowsLabel={t('dashboard.days.rows')}
              renderRow={(row) => (
                <>
                  <span>{day(row.day)}</span>
                  <span aria-hidden="true"> — </span>
                  <span>{t(WEATHER_KEYS[row.weather])}</span>
                </>
              )}
            />
            <p className="mt-1 text-caption text-fg-tertiary">{t('dashboard.weatherLost.hint')}</p>
          </div>
        </div>
      </Card>

      {week !== null && (
        <Card
          title={t('dashboard.week.title')}
          description={t('dashboard.week.range', { from: day(week.from), to: day(week.to) })}
        >
          <WeekFigures
            snapshot={snapshot}
            scheduled={scheduled}
            entries={entries}
            today={today}
            names={{ activities, stages }}
          />
        </Card>
      )}

      <Card title={t('dashboard.last.title')}>
        <div data-testid="last-entries">
          {last.rows.length === 0 ? (
            <p className="text-body text-fg-tertiary">{t('dashboard.last.none')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {last.rows.map((row) => {
                const entry = bySeq.get(row.seq);
                if (entry === undefined) return null;
                return (
                  <EntryView
                    key={row.seq}
                    entry={entry}
                    snapshot={snapshot}
                    correctedBySeq={corrected.get(entry.seq) ?? null}
                    footer={
                      <div>
                        <Button
                          appearance="subtle"
                          icon={<ArrowRight16Regular />}
                          data-testid="last-entry-open"
                          onClick={() => navigation.openDiary(row.seq)}
                        >
                          {t('dashboard.last.open', { seq: row.seq })}
                        </Button>
                      </div>
                    }
                  />
                );
              })}
            </ol>
          )}
        </div>
        {entries.length > last.rows.length && (
          <p className="mt-2 text-caption text-fg-tertiary">
            {tp('dashboard.last.of', entries.length, { shown: number(last.rows.length) })}
          </p>
        )}
      </Card>
    </>
  );
}

/**
 * This week on site, Monday to Sunday — the same week, and the same figures, the weekly report
 * prints: the entries, the working days that are over with none, who the diary says was there, and
 * who the plan expects.
 */
function WeekFigures({
  snapshot,
  scheduled,
  entries,
  today,
  names,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  entries: Parameters<typeof weekEntriesFigure>[0];
  today: string;
  names: {
    activities: ReadonlyMap<string, string>;
    stages: ReadonlyMap<string, string>;
  };
}) {
  const { t, tp, day, number } = useI18n();
  const week = weekOf(today)!;
  const entriesFigure = weekEntriesFigure(entries, week);
  const missing = weekDaysWithoutEntryFigure(
    weekDays(scheduled.calendar, week, today, snapshot.work.startDate, entries),
  );
  const onSite = onSiteFigure(snapshot, entries, week);
  const expected = peopleExpectedFigure(snapshot, scheduled, week);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FigureRow<EntryRow>
        testId="week-entries"
        size="title"
        figure={entriesFigure}
        label={t(DASHBOARD_LABEL_KEYS.weekEntries)}
        value={tp('reports.entries', entriesFigure.value)}
        rowsLabel={t('dashboard.figure.rows')}
        renderRow={(row) => (
          <>
            <span className="font-semibold text-fg">
              {t('reports.entryRow', { seq: row.seq, day: day(row.day ?? '') })}
            </span>
            {row.title !== '' && (
              <>
                <span aria-hidden="true"> — </span>
                <span>{shortened(row.title, NOTE_IN_ROW)}</span>
              </>
            )}
          </>
        )}
      />
      <FigureRow
        testId="week-days-without-entry"
        size="title"
        figure={missing}
        label={t(DASHBOARD_LABEL_KEYS.weekDaysWithoutEntry)}
        value={number(missing.value)}
        rowsLabel={t('dashboard.days.rows')}
        renderRow={(row) => <span>{day(row.day ?? '')}</span>}
      />
      <FigureRow<PersonRow>
        testId="on-site"
        size="title"
        figure={onSite}
        label={t(DASHBOARD_LABEL_KEYS.onSite)}
        value={number(onSite.value)}
        rowsLabel={t('dashboard.figure.rows')}
        renderRow={(row) => (
          <>
            <span className="font-semibold text-fg">
              {row.known ? row.title : t('reports.diary.unknownPerson')}
            </span>
            {row.trade !== null && (
              <>
                <span aria-hidden="true"> — </span>
                <span>{row.trade}</span>
              </>
            )}
            <span aria-hidden="true"> — </span>
            <span>{row.days.map((each) => day(each)).join(', ')}</span>
          </>
        )}
      />
      <div>
        <FigureRow<ExpectedRow>
          testId="people-expected"
          size="title"
          figure={expected}
          label={t(DASHBOARD_LABEL_KEYS.peopleExpected)}
          value={number(expected.value)}
          rowsLabel={t('dashboard.figure.rows')}
          renderRow={(row) => (
            <>
              <span className="font-semibold text-fg">{row.title}</span>
              {row.trade !== null && (
                <>
                  <span aria-hidden="true"> — </span>
                  <span>{row.trade}</span>
                </>
              )}
              {row.activityIds.length > 0 && (
                <>
                  <span aria-hidden="true"> — </span>
                  <span>
                    {row.activityIds.map((id) => names.activities.get(id) ?? id).join(', ')}
                  </span>
                </>
              )}
              {row.stageIds.length > 0 && (
                <>
                  <span aria-hidden="true"> — </span>
                  <span>
                    {t('dashboard.expected.stages', {
                      stages: row.stageIds.map((id) => names.stages.get(id) ?? id).join(', '),
                    })}
                  </span>
                </>
              )}
            </>
          )}
        />
        <p className="mt-1 text-caption text-fg-tertiary">{t('dashboard.expected.hint')}</p>
      </div>
    </div>
  );
}
