import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { useToday } from '@/app/today';
import type { WrittenFile } from '@/data/commands';
import {
  useDiary,
  useExportDiaryCsv,
  useExportDiaryPdf,
  useExportWorkJson,
  useVerifyDiary,
  useWriteReport,
} from '@/data/queries';
import { stageState } from '@/domain/checks';
import { weekOf } from '@/domain/dashboard';
import type { WorkSnapshot } from '@/domain/plan';
import { diaryReport } from '@/domain/reports/diary';
import {
  handover,
  handoverGaps,
  HANDOVER_LABEL_KEYS,
  type HandoverGapRow,
} from '@/domain/reports/handover';
import { scheduleReport } from '@/domain/reports/schedule';
import { weekly, type WeeklyProblem } from '@/domain/reports/weekly';
import { schedule, type Schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { keyFrom } from '@/domain/templates/export';
import type { MessageKey } from '@/i18n/en';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

import { composeDiary } from './compose/diary';
import { composeHandover, handoverGapText } from './compose/handover';
import { composeSchedule } from './compose/schedule';
import { composeWeekly, weekText } from './compose/weekly';
import { PathForm, ProblemBar, WrittenBar } from './PathForm';
import { useSaveTarget } from './useSaveTarget';

/**
 * Reports (slice F10): the files a work is written out as, one card each — the weekly report, the
 * diary, the schedule, the work as JSON and — last, for the owner — the handover book (D3). Each
 * card says in one line what its file holds and what
 * it does not, takes a path typed or chosen in the save dialog, and writes; the written path is
 * shown with **Open**, and a refusal is shown on the card in its own sentence.
 *
 * Every document is composed here from the same domain rows the screens show, in the same words
 * (decision 1): the weekly report in the owner's words whatever lens is on screen; the diary and the
 * schedule in the lens on screen. The host lays each one out and writes it; nothing about the work
 * changes, and nothing leaves the machine.
 */
export function ReportsPage({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t } = useI18n();
  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.reports')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('reports.lead')}</p>
      </header>

      <WeeklyCard snapshot={snapshot} scheduled={scheduled} />
      <DiaryCard snapshot={snapshot} />
      <ScheduleCard snapshot={snapshot} scheduled={scheduled} />
      <JsonCard snapshot={snapshot} />
      <HandoverCard snapshot={snapshot} />
    </div>
  );
}

/** What each card keeps between the path and the host's answer. */
function useOutcome() {
  const [done, setDone] = useState<WrittenFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const clear = useCallback(() => {
    setDone(null);
    setProblem(null);
  }, []);
  return { done, setDone, problem, setProblem, clear };
}

/** A file written: shown on the card and said aloud, with its path. */
function written(i18n: I18n, file: WrittenFile, setDone: (file: WrittenFile) => void) {
  setDone(file);
  announce(i18n.t('reports.done.announce', { path: file.path }));
}

function problemText(i18n: I18n, problem: WeeklyProblem): string {
  return i18n.t(
    problem.messageKey as MessageKey,
    problem.code === 'future-week' ? { from: i18n.day(problem.from) } : undefined,
  );
}

function WeeklyCard({ snapshot, scheduled }: { snapshot: WorkSnapshot; scheduled: Schedule }) {
  const i18n = useI18n();
  const { t, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const diary = useDiary(true);
  const write = useWriteReport();
  const outcome = useOutcome();
  const id = useId();
  // Any day of the week; the week of today until another is chosen.
  const [day, setDay] = useState(today);
  const week = weekOf(day);
  const suggested = useCallback(
    () =>
      t('reports.file.weekly', {
        work: keyFrom(snapshot.work.name, 'work'),
        week: week?.from ?? today,
      }),
    [snapshot.work.name, t, today, week?.from],
  );
  const target = useSaveTarget('pdf', suggested);

  const submit = () => {
    outcome.clear();
    const where = target.target();
    if (!where.ok) {
      outcome.setProblem(where.problem);
      return;
    }
    if (diary.data === undefined) return;
    const selection = weekly(snapshot, scheduled, diary.data, day, today);
    if (!selection.ok) {
      outcome.setProblem(problemText(i18n, selection.problem));
      return;
    }
    write.mutate(
      {
        path: where.path,
        document: composeWeekly(
          selection.weekly,
          snapshot,
          scheduled,
          i18n,
          finishProbability(snapshot, scheduled, { entries: diary.data }),
        ),
        overwrite: where.overwrite,
      },
      {
        onSuccess: (file) => written(i18n, file, outcome.setDone),
        onError: (error) => outcome.setProblem(describeError(error)),
      },
    );
  };

  return (
    <Card title={term('report', { capital: true })}>
      <p className="mb-3 text-body text-fg-secondary">{t('reports.weekly.holds')}</p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-week`} className="text-caption font-semibold text-fg-secondary">
            {t('reports.week')}
          </label>
          <Input
            id={`${id}-week`}
            type="date"
            data-testid="weekly-week"
            className="max-w-56"
            aria-describedby={`${id}-week-hint`}
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              outcome.clear();
            }}
          />
          <span id={`${id}-week-hint`} className="text-caption text-fg-tertiary">
            {week === null
              ? t('reports.weekly.problem.invalidWeek')
              : weekText(i18n, week.from, week.to)}
          </span>
        </div>
        <PathForm
          target={target}
          testId="weekly-path"
          writeTestId="weekly-write"
          writeLabel={t('reports.weekly.write')}
          writing={write.isPending}
          disabled={diary.data === undefined}
          onEdited={outcome.clear}
          onWrite={submit}
        >
          {diary.isPending && (
            <span className="text-caption text-fg-tertiary">{t('reports.weekly.waiting')}</span>
          )}
        </PathForm>
        {diary.isError && (
          <ProblemBar testId="weekly-problem" problem={describeError(diary.error)} />
        )}
        {outcome.problem !== null && (
          <ProblemBar testId="weekly-problem" problem={outcome.problem} />
        )}
        {outcome.done !== null && (
          <WrittenBar
            testId="weekly-done"
            written={outcome.done}
            onOpenFailed={(error) => outcome.setProblem(describeError(error))}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * The diary, as a PDF and as CSV. The chain is verified when the card opens and the sentence says
 * what was found — "3 entries, chain verified just now" — before anything is written; the host
 * verifies it again at the moment of writing and refuses both files when it does not hold.
 */
function DiaryCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, tp, describeError, language } = i18n;
  const term = useTerms();
  const diary = useDiary(true);
  const verify = useVerifyDiary();
  const pdf = useExportDiaryPdf();
  const csv = useExportDiaryCsv();
  const outcome = useOutcome();
  const pdfName = useCallback(
    () => t('reports.file.diary', { work: keyFrom(snapshot.work.name, 'work') }),
    [snapshot.work.name, t],
  );
  const pdfTarget = useSaveTarget('pdf', pdfName);
  const csvTarget = useSaveTarget('csv', pdfName);
  // What each language's spreadsheet expects: a comma in English, a semicolon in Portuguese, where
  // the comma is the decimal mark.
  const separator = language === 'pt-BR' ? ';' : ',';

  const { mutate: verifyNow } = verify;
  useEffect(() => {
    verifyNow();
  }, [verifyNow]);

  const report = verify.data ?? null;
  const chain =
    report === null
      ? t('reports.diary.chain.checking')
      : report.intact
        ? report.entries === 0
          ? t('reports.diary.chain.empty')
          : tp('reports.diary.chain.intact', report.entries)
        : t('reports.diary.chain.broken', {
            seq: report.brokenAt,
            reason:
              report.problem === 'contents'
                ? t('diagnostics.diary.problem.contents')
                : report.problem === 'link'
                  ? t('diagnostics.diary.problem.link')
                  : report.problem === 'missing'
                    ? t('diagnostics.diary.problem.missing')
                    : report.reason,
          });

  const done = {
    onSuccess: (file: WrittenFile) => {
      written(i18n, file, outcome.setDone);
      verifyNow();
    },
    onError: (error: unknown) => {
      outcome.setProblem(describeError(error));
      verifyNow();
    },
  };

  const writePdf = () => {
    outcome.clear();
    const where = pdfTarget.target();
    if (!where.ok) {
      outcome.setProblem(where.problem);
      return;
    }
    if (diary.data === undefined) return;
    pdf.mutate(
      {
        path: where.path,
        document: composeDiary(diaryReport(snapshot, diary.data), snapshot, i18n, term),
        overwrite: where.overwrite,
      },
      done,
    );
  };

  const writeCsv = () => {
    outcome.clear();
    const where = csvTarget.target();
    if (!where.ok) {
      outcome.setProblem(where.problem);
      return;
    }
    csv.mutate({ path: where.path, separator, overwrite: where.overwrite }, done);
  };

  const pending = pdf.isPending || csv.isPending;

  return (
    <Card title={t('reports.diary.title')}>
      <p className="mb-3 text-body text-fg-secondary">{t('reports.diary.holds')}</p>
      <div className="flex flex-col gap-3">
        {report !== null && !report.intact ? (
          <div data-testid="diary-chain">
            <InfoBar severity="danger" title={t('reports.problem')}>
              {chain}
            </InfoBar>
          </div>
        ) : (
          <p
            data-testid="diary-chain"
            data-intact={report === null ? undefined : 'true'}
            className="text-body text-fg"
          >
            {chain}
          </p>
        )}
        {verify.isError && (
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(verify.error)}
          </InfoBar>
        )}
        <p className="text-caption text-fg-tertiary">{t('diary.chain.note')}</p>
        <PathForm
          target={pdfTarget}
          testId="diary-pdf-path"
          writeTestId="diary-pdf-write"
          writeLabel={t('reports.diary.writePdf')}
          writing={pdf.isPending}
          disabled={pending || diary.data === undefined}
          onEdited={outcome.clear}
          onWrite={writePdf}
        />
        <PathForm
          target={csvTarget}
          testId="diary-csv-path"
          writeTestId="diary-csv-write"
          writeLabel={t('reports.diary.writeCsv')}
          writing={csv.isPending}
          disabled={pending}
          onEdited={outcome.clear}
          onWrite={writeCsv}
        >
          <span className="text-caption text-fg-tertiary">
            {t('reports.diary.separator', { separator })}
          </span>
          <span className="text-caption text-fg-tertiary">{t('reports.diary.csvHolds')}</span>
        </PathForm>
        {diary.isError && (
          <ProblemBar testId="diary-problem" problem={describeError(diary.error)} />
        )}
        {outcome.problem !== null && (
          <ProblemBar testId="diary-problem" problem={outcome.problem} />
        )}
        {outcome.done !== null && (
          <WrittenBar
            testId="diary-done"
            written={outcome.done}
            onOpenFailed={(error) => outcome.setProblem(describeError(error))}
          />
        )}
      </div>
    </Card>
  );
}

function ScheduleCard({ snapshot, scheduled }: { snapshot: WorkSnapshot; scheduled: Schedule }) {
  const i18n = useI18n();
  const { t, describeError } = i18n;
  const term = useTerms();
  const write = useWriteReport();
  const outcome = useOutcome();
  const suggested = useCallback(
    () => t('reports.file.schedule', { work: keyFrom(snapshot.work.name, 'work') }),
    [snapshot.work.name, t],
  );
  const target = useSaveTarget('pdf', suggested);

  const submit = () => {
    outcome.clear();
    const where = target.target();
    if (!where.ok) {
      outcome.setProblem(where.problem);
      return;
    }
    write.mutate(
      {
        path: where.path,
        document: composeSchedule(scheduleReport(snapshot, scheduled), snapshot, i18n, term),
        overwrite: where.overwrite,
      },
      {
        onSuccess: (file) => written(i18n, file, outcome.setDone),
        onError: (error) => outcome.setProblem(describeError(error)),
      },
    );
  };

  return (
    <Card title={t('reports.schedule.title')}>
      <p className="mb-3 text-body text-fg-secondary">{t('reports.schedule.holds')}</p>
      <div className="flex flex-col gap-3">
        <PathForm
          target={target}
          testId="schedule-pdf-path"
          writeTestId="schedule-pdf-write"
          writeLabel={t('reports.schedule.write')}
          writing={write.isPending}
          onEdited={outcome.clear}
          onWrite={submit}
        />
        {outcome.problem !== null && (
          <ProblemBar testId="schedule-problem" problem={outcome.problem} />
        )}
        {outcome.done !== null && (
          <WrittenBar
            testId="schedule-done"
            written={outcome.done}
            onOpenFailed={(error) => outcome.setProblem(describeError(error))}
          />
        )}
      </div>
    </Card>
  );
}

function JsonCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, describeError } = i18n;
  const write = useExportWorkJson();
  const outcome = useOutcome();
  const suggested = useCallback(() => keyFrom(snapshot.work.name, 'work'), [snapshot.work.name]);
  const target = useSaveTarget('json', suggested);

  const submit = () => {
    outcome.clear();
    const where = target.target();
    if (!where.ok) {
      outcome.setProblem(where.problem);
      return;
    }
    write.mutate(
      { path: where.path, overwrite: where.overwrite },
      {
        onSuccess: (file) => written(i18n, file, outcome.setDone),
        onError: (error) => outcome.setProblem(describeError(error)),
      },
    );
  };

  return (
    <Card title={t('reports.json.title')}>
      <p className="mb-3 text-body text-fg-secondary">{t('reports.json.holds')}</p>
      <div className="flex flex-col gap-3">
        <PathForm
          target={target}
          testId="json-path"
          writeTestId="json-write"
          writeLabel={t('reports.json.write')}
          writing={write.isPending}
          onEdited={outcome.clear}
          onWrite={submit}
        />
        {outcome.problem !== null && <ProblemBar testId="json-problem" problem={outcome.problem} />}
        {outcome.done !== null && (
          <WrittenBar
            testId="json-done"
            written={outcome.done}
            onOpenFailed={(error) => outcome.setProblem(describeError(error))}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * The handover book (D3, decisions 6 and 7): one PDF the owner keeps — room by room what was done,
 * the decisions, the photos of hidden work, the documents by name, who did what and the care notes —
 * always in the owner's words, as the weekly report is.
 *
 * Before anything is written the card says **what the book still lacks** (`handover-gaps`): a figure
 * that opens onto its rows — a hidden-work check answered without its photo, a stage not closed, a
 * room with no photo — computed from the same rows the book is composed from. Writing is allowed
 * anyway: the book may be wanted mid-work, and its first page then says it was written while the
 * work was in progress, which the card also says beforehand.
 */
function HandoverCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, tp, number, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const diary = useDiary(true);
  const write = useWriteReport();
  const outcome = useOutcome();
  const suggested = useCallback(
    () => t('reports.file.handover', { work: keyFrom(snapshot.work.name, 'work') }),
    [snapshot.work.name, t],
  );
  const target = useSaveTarget('pdf', suggested);
  const gaps = useMemo(
    () => (diary.data === undefined ? null : handoverGaps(snapshot, diary.data)),
    [snapshot, diary.data],
  );
  const open =
    snapshot.stages.length === 0 || snapshot.stages.some((stage) => stageState(stage) !== 'closed');
  const book = term('handoverBook');

  const submit = () => {
    outcome.clear();
    const where = target.target();
    if (!where.ok) {
      outcome.setProblem(where.problem);
      return;
    }
    if (diary.data === undefined) return;
    write.mutate(
      {
        path: where.path,
        document: composeHandover(handover(snapshot, diary.data), snapshot, i18n, today),
        overwrite: where.overwrite,
      },
      {
        onSuccess: (file) => written(i18n, file, outcome.setDone),
        onError: (error) => outcome.setProblem(describeError(error)),
      },
    );
  };

  return (
    <Card title={t('reports.handover.title', { book })}>
      <p className="mb-3 text-body text-fg-secondary">{t('reports.handover.holds')}</p>
      <div className="flex flex-col gap-3">
        {gaps === null ? (
          <p className="text-body text-fg-tertiary">
            {diary.isError ? describeError(diary.error) : t('reports.weekly.waiting')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <FigureRow<HandoverGapRow>
              figure={gaps}
              testId="handover-gaps"
              size="title"
              label={t(HANDOVER_LABEL_KEYS.gaps as MessageKey)}
              value={number(gaps.value)}
              rowsLabel={t('reports.handover.gaps.rows')}
              renderRow={(gap) => handoverGapText(i18n, term, gap)}
            />
            <p data-testid="handover-gaps-sentence" className="text-body text-fg">
              {gaps.value === 0
                ? t('reports.handover.gaps.nothing', { book })
                : tp('reports.handover.gaps.sentence', gaps.value, { book })}
            </p>
          </div>
        )}
        {open && (
          <p data-testid="handover-in-progress" className="text-caption text-fg-secondary">
            {t('reports.handover.inProgressNote', { stage: term('stage') })}
          </p>
        )}
        <PathForm
          target={target}
          testId="handover-path"
          writeTestId="handover-write"
          writeLabel={t('reports.handover.write', { book })}
          writing={write.isPending}
          disabled={diary.data === undefined}
          onEdited={outcome.clear}
          onWrite={submit}
        />
        {outcome.problem !== null && (
          <ProblemBar testId="handover-problem" problem={outcome.problem} />
        )}
        {outcome.done !== null && (
          <WrittenBar
            testId="handover-done"
            written={outcome.done}
            onOpenFailed={(error) => outcome.setProblem(describeError(error))}
          />
        )}
      </div>
    </Card>
  );
}
