import {
  Add20Regular,
  ChevronDown20Regular,
  ChevronUp20Regular,
  Save20Regular,
} from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { LIMITS } from '@/data/commands';
import { useSetCalendar } from '@/data/queries';
import {
  formatWorkingDays,
  isIsoDay,
  parseWorkingDays,
  validateCalendar,
  type CalendarProblem,
} from '@/domain/calendar';
import type { Holiday, WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

import type { Outcome } from './outcome';

const WEEKDAYS_ONLY = [true, true, true, true, true, false, false];

/**
 * The working calendar, where durations are counted: which weekdays the site works, how many
 * hours, and the holidays it does not (slice F1, the F0 deferral).
 *
 * Collapsed to one line until asked for. Opened, it is a draft — the weekdays, the hours and the
 * holiday list — kept together by one Save, because a calendar is one decision and half of one is
 * a calendar nobody chose. The domain checks the draft before the host is asked (a week with no
 * working day could never schedule anything: refused with the sentence), and whatever the host
 * keeps moves the finish date on the dashboard.
 */
export function CalendarCard({
  snapshot,
  outcome,
  open,
  onOpen,
}: {
  snapshot: WorkSnapshot;
  outcome: Outcome;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const { t, tp, number, workingDays } = useI18n();
  const term = useTerms();
  const body = useId();
  const mask = parseWorkingDays(snapshot.calendar.workingDays);

  return (
    <Card
      title={term('calendar', { capital: true })}
      actions={
        <Button
          appearance="subtle"
          data-testid="calendar-toggle"
          aria-expanded={open}
          aria-controls={body}
          icon={open ? <ChevronUp20Regular /> : <ChevronDown20Regular />}
          onClick={() => onOpen(!open)}
        >
          {open ? t('plan.calendar.hide') : t('plan.calendar.show')}
        </Button>
      }
    >
      {open ? (
        <div id={body}>
          <CalendarEditor snapshot={snapshot} outcome={outcome} />
        </div>
      ) : (
        <p className="text-body text-fg-secondary">
          {[
            mask === null ? t('dashboard.calendar.unreadable') : workingDays(mask),
            t('plan.calendar.hours', { hours: number(snapshot.calendar.hoursPerDay) }),
            snapshot.holidays.length === 0
              ? t('plan.calendar.noHolidays')
              : tp('plan.calendar.holidays', snapshot.holidays.length),
          ].join(' · ')}
        </p>
      )}
    </Card>
  );
}

/** What each refusal of the domain's is, said. */
function problemKey(problem: CalendarProblem): MessageKey {
  switch (problem.code) {
    case 'no-working-day':
      return 'work.invalid.noWorkingDay';
    case 'hours-per-day':
      return 'work.invalid.hours';
    case 'holiday-date':
      return 'plan.calendar.badHoliday';
    case 'working-days-mask':
      return 'dashboard.calendar.unreadable';
  }
}

function sameHolidays(a: readonly Holiday[], b: readonly Holiday[]): boolean {
  return (
    a.length === b.length &&
    a.every((holiday, index) => holiday.date === b[index]?.date && holiday.name === b[index]?.name)
  );
}

function CalendarEditor({ snapshot, outcome }: { snapshot: WorkSnapshot; outcome: Outcome }) {
  const { t, weekdays, day, describeError } = useI18n();
  const term = useTerms();
  const save = useSetCalendar();
  const [days, setDays] = useState<boolean[]>(() => [
    ...(parseWorkingDays(snapshot.calendar.workingDays) ?? WEEKDAYS_ONLY),
  ]);
  const [hours, setHours] = useState(String(snapshot.calendar.hoursPerDay));
  const [holidays, setHolidays] = useState<Holiday[]>(() =>
    [...snapshot.holidays].sort((a, b) => a.date.localeCompare(b.date)),
  );
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const heading = useId();

  const dirty =
    formatWorkingDays(days) !== snapshot.calendar.workingDays ||
    Number(hours) !== snapshot.calendar.hoursPerDay ||
    !sameHolidays(
      holidays,
      [...snapshot.holidays].sort((a, b) => a.date.localeCompare(b.date)),
    );

  const names = weekdays('long');

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isIsoDay(newDate)) {
      setAddProblem(t('plan.calendar.holidayDate'));
      return;
    }
    if (holidays.some((holiday) => holiday.date === newDate)) {
      setAddProblem(t('plan.calendar.holidayTwice', { day: day(newDate) }));
      return;
    }
    setAddProblem(null);
    setHolidays((all) =>
      [...all, { date: newDate, name: newName.trim() }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
    setNewDate('');
    setNewName('');
    setSaved(false);
  };

  const submit = () => {
    const hoursPerDay = Number(hours);
    const checked = validateCalendar({
      workingDays: days,
      hoursPerDay,
      holidays: new Set(holidays.map((holiday) => holiday.date)),
    });
    if (!checked.ok) {
      setProblems(
        checked.problems.map((problem) =>
          t(problemKey(problem), problem.code === 'holiday-date' ? { date: problem.date } : {}),
        ),
      );
      setSaved(false);
      return;
    }
    save.mutate(
      { calendar: { workingDays: formatWorkingDays(days), hoursPerDay }, holidays },
      {
        onSuccess: () => {
          setProblems([]);
          setSaved(true);
          outcome.kept();
        },
        onError: (error) => {
          setProblems([describeError(error)]);
          setSaved(false);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <fieldset data-testid="calendar-working-days" className="flex flex-col gap-2">
        <legend className="mb-1 text-caption font-semibold text-fg-secondary">
          {term('workingDay', { capital: true })}
        </legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {names.map((name, index) => (
            <label key={name} className="flex items-center gap-2 text-body text-fg">
              <Checkbox
                label={name}
                checked={days[index] === true}
                onChange={(checked) => {
                  setDays((all) => all.map((flag, at) => (at === index ? checked : flag)));
                  setSaved(false);
                }}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex max-w-60 flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('work.field.hours')}
        </span>
        <Input
          type="number"
          inputMode="decimal"
          min={0.5}
          max={LIMITS.hoursPerDay}
          step={0.5}
          data-testid="calendar-hours"
          value={hours}
          onChange={(event) => {
            setHours(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <section aria-labelledby={heading} className="flex flex-col gap-2">
        <h3 id={heading} className="text-caption font-semibold text-fg-secondary">
          {t('plan.calendar.holidaysTitle')}
        </h3>
        {holidays.length === 0 ? (
          <p className="text-body text-fg-tertiary">{t('plan.calendar.noHolidays')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {holidays.map((holiday) => (
              <li
                key={holiday.date}
                data-holiday-date={holiday.date}
                className="flex items-center gap-3 rounded-md border border-stroke-subtle px-3 py-1"
              >
                <span className="text-body text-fg">{day(holiday.date)}</span>
                <span className="min-w-0 flex-1 truncate text-body text-fg-secondary">
                  {holiday.name}
                </span>
                <Button
                  appearance="subtle"
                  data-testid="holiday-remove"
                  onClick={() => {
                    setHolidays((all) => all.filter((each) => each.date !== holiday.date));
                    setSaved(false);
                  }}
                >
                  {t('plan.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={add}
          noValidate
          className="grid grid-cols-[10rem_minmax(0,1fr)_auto] items-start gap-2"
        >
          <Input
            type="date"
            data-testid="holiday-date"
            aria-label={t('plan.calendar.holidayDay')}
            value={newDate}
            onChange={(event) => setNewDate(event.target.value)}
          />
          <Input
            data-testid="holiday-name"
            aria-label={t('plan.calendar.holidayName')}
            placeholder={t('plan.calendar.holidayName')}
            maxLength={LIMITS.name}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button type="submit" icon={<Add20Regular />} data-testid="holiday-add">
            {t('plan.add', { what: term('holiday') })}
          </Button>
        </form>
        {addProblem !== null && (
          <span className="text-caption text-fg-secondary">{addProblem}</span>
        )}
      </section>

      {problems.length > 0 && (
        <div data-testid="calendar-problem">
          <InfoBar severity="caution" title={t('plan.calendar.notSaved')}>
            <ul className="flex flex-col gap-0.5">
              {problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          </InfoBar>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          appearance="accent"
          icon={<Save20Regular />}
          data-testid="calendar-save"
          disabled={save.isPending}
          onClick={submit}
        >
          {save.isPending ? t('common.working') : t('plan.calendar.save')}
        </Button>
        <span className="text-caption text-fg-tertiary">
          {dirty ? t('plan.calendar.unsaved') : saved ? t('plan.calendar.saved') : ''}
        </span>
      </div>
    </div>
  );
}
