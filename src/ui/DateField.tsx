import {
  Calendar20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
} from '@fluentui/react-icons';
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

import { today } from '@/app/today';
import { formatDay, formatDayShort, weekdayNames } from '@/i18n/format';
import {
  formatDayInput,
  isMachineDay,
  isStoredDay,
  readDayInput,
  type DayReading,
} from '@/i18n/dayInput';
import type { Language, MessageKey } from '@/i18n/index';
import { useI18n } from '@/i18n/useI18n';

import { FIELD_SURFACE } from './fieldSurface';
import { IconButton } from './IconButton';
import { InfoBar } from './InfoBar';

/**
 * The canonical date field: a day shown and typed in the **product's** language, never the
 * webview's.
 *
 * A native `<input type="date">` draws its day in the order of the machine's locale, so a work in
 * Portuguese on an English Windows showed `10/02/2026` month first — the 2nd of October to the
 * person reading it as the 10th of February. This field shows `10/02/2026` in Portuguese and
 * `Feb 10, 2026` in English (the month as a word, so it cannot be read the wrong way round), reads
 * what is typed forgivingly in the same language (`readDayInput`), and opens a month grid of its
 * own for choosing with the pointer or the keyboard.
 *
 * **The value in and out is the stored form, `YYYY-MM-DD`, or `''`** — exactly what the native
 * field gave, so a caller keeps its contract. Text that is not a whole day yet gives `''`, as the
 * native field did, and the field says what is wrong with it in its own problem line once the
 * person leaves it.
 *
 * The `data-testid` is on the text field itself, and the stored form typed or set into it is read
 * as that day: setting `2026-02-10` through the native value setter and an `input` event — what the
 * end-to-end suite does — chooses the 10th of February and shows it in the language on screen.
 */
export interface DateFieldProps {
  /** The day, `YYYY-MM-DD`, or `''` for none. */
  value: string;
  /** Called with the new day, `YYYY-MM-DD`, or `''` when the text is empty or not a day yet. */
  onChange: (value: string) => void;
  /**
   * A visible label, in the canonical caption style. Without it the caller names the field — its
   * own `<label htmlFor={id}>`, or `aria-label`.
   */
  label?: string | undefined;
  id?: string | undefined;
  'aria-label'?: string | undefined;
  /** More of the caller's descriptions; the field adds its own hint and problem to them. */
  'aria-describedby'?: string | undefined;
  'data-testid'?: string | undefined;
  /** The earliest day the calendar offers, `YYYY-MM-DD`. Typing an earlier one is the caller's to refuse. */
  min?: string | undefined;
  /** The latest day the calendar offers, `YYYY-MM-DD`. Typing a later one is the caller's to refuse. */
  max?: string | undefined;
  disabled?: boolean;
  /**
   * `visible` (the default) prints the expected form under the field; `hidden` keeps it for a
   * screen reader only, for a field in a row where a line under it would break the row — the
   * placeholder still shows the form while the field is empty.
   */
  hint?: 'visible' | 'hidden';
  /** On the outer element: the field's width in its layout. */
  className?: string;
  /**
   * Told whether the field holds text that is not a day yet. `onChange` says `''` for that text, as
   * for an empty field — an optional day's form needs this to refuse rather than save "no day".
   */
  onPendingChange?: (pending: boolean) => void;
}

/** The day the examples show: the one a Brazilian must never read as the 2nd of October. */
const EXAMPLE_DAY = '2026-02-10';

const PROBLEM_KEYS: Record<'partial' | 'not-a-day' | 'month-as-word', MessageKey> = {
  partial: 'dateField.problem.partial',
  'not-a-day': 'dateField.problem.notADay',
  'month-as-word': 'dateField.problem.monthAsWord',
};

function problemOf(reading: DayReading): keyof typeof PROBLEM_KEYS | null {
  return reading.kind === 'partial' ||
    reading.kind === 'not-a-day' ||
    reading.kind === 'month-as-word'
    ? reading.kind
    : null;
}

export function DateField({
  value,
  onChange,
  label,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'data-testid': testId,
  min,
  max,
  disabled = false,
  hint = 'visible',
  className = '',
  onPendingChange,
}: DateFieldProps) {
  const { t, language } = useI18n();
  const base = useId();
  const inputId = id ?? `${base}-input`;
  const hintId = `${base}-hint`;
  const problemId = `${base}-problem`;

  // The text stands for `held` in `shownIn`. When the caller's value moves somewhere the text did
  // not take it — a form cleared after saving, a day chosen elsewhere — or the language changes,
  // the text follows; otherwise what the person is typing is left alone, even while it is not a
  // day yet and the value is `''`.
  const [text, setText] = useState(() => formatDayInput(language, value));
  const [held, setHeld] = useState(value);
  const [shownIn, setShownIn] = useState(language);
  if (value !== held || language !== shownIn) {
    setHeld(value);
    setShownIn(language);
    if (value !== held || isStoredDay(value)) setText(formatDayInput(language, value));
  }

  // A problem is said once the person has left the field, not on every keystroke on the way to a
  // day; after that it follows the text, and goes the moment the text is a day.
  const [judged, setJudged] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLDivElement>(null);

  const reading = readDayInput(language, text);
  const problem = judged ? problemOf(reading) : null;
  const pending = text.trim() !== '' && reading.kind !== 'day';
  // The callback is an effect event and the effect runs on `pending` alone: a caller that passes an
  // inline function that sets state would otherwise re-run it on every render, for ever (G1 found
  // it — a test worker grew to 1.6 GB).
  const tellPending = useEffectEvent((now: boolean) => onPendingChange?.(now));
  useEffect(() => {
    tellPending(pending);
  }, [pending]);
  const example = formatDayInput(language, EXAMPLE_DAY);

  const emit = (next: string) => {
    setHeld(next);
    if (next !== value) onChange(next);
  };

  const type = (event: ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value;
    const read = readDayInput(language, typed);
    const next = read.kind === 'day' ? read.iso : '';
    // The stored form is the machine's, never what the language shows: set or pasted, it is shown
    // at once as the language writes it. Anything else typed stays as typed until the field is left.
    setText(read.kind === 'day' && isMachineDay(typed) ? formatDayInput(language, next) : typed);
    emit(next);
  };

  const leave = () => {
    setJudged(true);
    if (reading.kind === 'day') setText(formatDayInput(language, reading.iso));
  };

  const choose = (iso: string) => {
    setText(formatDayInput(language, iso));
    setJudged(false);
    emit(iso);
    setOpen(false);
    opener.current?.focus();
  };

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };

  // A press anywhere outside the field and its calendar closes the calendar.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const describedByAll =
    [describedBy, hintId, problem === null ? null : problemId].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div
      ref={wrapper}
      className={`flex flex-col gap-1 ${className}`}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        // Focus that leaves the field and its calendar altogether closes the calendar.
        if (open && !wrapper.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {label !== undefined && (
        <label htmlFor={inputId} className="text-caption font-semibold text-fg-secondary">
          {label}
        </label>
      )}
      <div ref={anchor} className="relative">
        <input
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          data-testid={testId}
          data-day={value}
          aria-label={ariaLabel}
          aria-describedby={describedByAll}
          aria-invalid={problem === null ? undefined : true}
          placeholder={t('dateField.placeholder')}
          disabled={disabled}
          value={text}
          onChange={type}
          onBlur={leave}
          onKeyDown={(event) => {
            // Alt+Down opens a date picker on Windows; the button beside the field does the same.
            if (event.altKey && event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={['h-(--density-control) pr-10', FIELD_SURFACE].join(' ')}
        />
        <span className="absolute top-0 right-0">
          <IconButton
            ref={opener}
            label={t('dateField.open')}
            icon={<Calendar20Regular />}
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((was) => !was)}
          />
        </span>
        {open && (
          <MonthGrid
            anchor={anchor}
            language={language}
            value={value}
            min={min !== undefined && isStoredDay(min) ? min : null}
            max={max !== undefined && isStoredDay(max) ? max : null}
            onChoose={choose}
            onClose={close}
          />
        )}
      </div>
      <span
        id={hintId}
        className={hint === 'visible' ? 'text-caption text-fg-tertiary' : 'sr-only'}
      >
        {t('dateField.hint', { example })}
      </span>
      {problem !== null && (
        <div id={problemId} data-testid={testId === undefined ? undefined : `${testId}-problem`}>
          <InfoBar severity="caution" title={t('dateField.problem.title')}>
            {t(PROBLEM_KEYS[problem], {
              example,
              worded: formatDayShort(language, EXAMPLE_DAY),
              text: text.trim(),
            })}
          </InfoBar>
        </div>
      )}
    </div>
  );
}

// ── The month grid ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The space between the field and its calendar, in pixels: the 4 px step of the spacing scale. */
const POPOVER_GAP = 4;

const toIso = (moment: Date) => moment.toISOString().slice(0, 10);
const atUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso: string, days: number) =>
  toIso(new Date(atUtc(iso).getTime() + days * DAY_MS));

/** The same day of another month, or that month's last day when it is shorter. */
function addMonths(iso: string, months: number): string {
  const moment = atUtc(iso);
  const first = new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(moment.getUTCDate(), last));
  return toIso(first);
}

/** Monday first, as the working-days mask and every week in the product. */
const weekdayIndex = (iso: string) => (atUtc(iso).getUTCDay() + 6) % 7;

/** The weeks of the month `iso` is in, Monday to Sunday; days of the next or last month are `null`. */
function weeksOf(iso: string): Array<Array<string | null>> {
  const first = `${iso.slice(0, 7)}-01`;
  const month = iso.slice(0, 7);
  const weeks: Array<Array<string | null>> = [];
  let cursor = addDays(first, -weekdayIndex(first));
  while (weeks.length === 0 || cursor.slice(0, 7) === month) {
    const week: Array<string | null> = [];
    for (let index = 0; index < 7; index += 1) {
      week.push(cursor.slice(0, 7) === month ? cursor : null);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function MonthGrid({
  anchor,
  language,
  value,
  min,
  max,
  onChoose,
  onClose,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  language: Language;
  value: string;
  min: string | null;
  max: string | null;
  onChoose: (iso: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const base = useId();
  const now = today();
  const within = (iso: string) => (min === null || iso >= min) && (max === null || iso <= max);
  const start = isStoredDay(value)
    ? value
    : max !== null && now > max
      ? max
      : min !== null && now < min
        ? min
        : now;

  // The day that has the focus in the grid, and whether the focus belongs there now (after a key
  // in the grid or on opening) or stays on the month buttons the person pressed.
  const [cursor, setCursor] = useState(start);
  const [focusDay, setFocusDay] = useState(true);
  const grid = useRef<HTMLTableElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The calendar is a popover in the top layer, placed under the field (over it when there is no
  // room below): a field inside a dialog that clips its overflow still shows the whole month.
  useLayoutEffect(() => {
    const element = panel.current;
    const field = anchor.current;
    if (element === null || field === null) return;
    try {
      element.showPopover();
    } catch {
      // No popover support: it stays a fixed box over the page, which is still all there.
    }
    const place = () => {
      const box = field.getBoundingClientRect();
      const height = element.offsetHeight;
      const below = box.bottom + POPOVER_GAP;
      const fitsBelow = below + height <= window.innerHeight;
      const above = box.top - POPOVER_GAP - height;
      element.style.top = `${!fitsBelow && above >= 0 ? above : below}px`;
      element.style.left = `${Math.max(0, Math.min(box.left, window.innerWidth - element.offsetWidth))}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    if (!focusDay) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor, focusDay]);

  const move = (next: string) => {
    setFocusDay(true);
    setCursor(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => addDays(cursor, -weekdayIndex(cursor)),
      End: () => addDays(cursor, 6 - weekdayIndex(cursor)),
      PageUp: () => addMonths(cursor, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(cursor, event.shiftKey ? 12 : 1),
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    move(step());
  };

  const heading = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(atUtc(cursor));
  const short = weekdayNames(language, 'short');
  const long = weekdayNames(language, 'long');

  return (
    <div
      ref={panel}
      popover="manual"
      role="dialog"
      aria-labelledby={`${base}-month`}
      aria-describedby={`${base}-keys`}
      data-testid="date-field-calendar"
      className="fixed inset-auto m-0 w-max rounded-lg border border-stroke-subtle bg-flyout p-3 text-fg shadow-flyout"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        // Escape closes the calendar, not the dialog the field may be in.
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <IconButton
          label={t('dateField.previousMonth')}
          icon={<ChevronLeft20Regular />}
          onClick={() => {
            setFocusDay(false);
            setCursor(addMonths(cursor, -1));
          }}
        />
        <p id={`${base}-month`} className="text-body font-semibold text-fg">
          {heading}
        </p>
        <IconButton
          label={t('dateField.nextMonth')}
          icon={<ChevronRight20Regular />}
          onClick={() => {
            setFocusDay(false);
            setCursor(addMonths(cursor, 1));
          }}
        />
      </div>
      <p id={`${base}-keys`} className="sr-only">
        {t('dateField.keys')}
      </p>
      <table ref={grid} role="grid" aria-labelledby={`${base}-month`} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {short.map((name, index) => (
              <th
                key={name}
                scope="col"
                abbr={long[index]}
                className="size-8 text-caption font-normal text-fg-tertiary"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(cursor).map((week) => (
            <tr key={week.find((day) => day !== null) ?? ''}>
              {week.map((day, index) =>
                day === null ? (
                  <td key={`blank-${index}`} />
                ) : (
                  <td key={day} aria-selected={day === value}>
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === cursor ? 0 : -1}
                      aria-label={formatDay(language, day)}
                      aria-current={day === now ? 'date' : undefined}
                      aria-disabled={within(day) ? undefined : true}
                      onClick={() => {
                        if (within(day)) onChoose(day);
                        else move(day);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        if (within(day)) onChoose(day);
                      }}
                      className={[
                        'size-8 rounded-md border text-body',
                        'transition-colors duration-100 ease-easy',
                        day === now ? 'border-stroke-strong font-semibold' : 'border-transparent',
                        !within(day)
                          ? 'cursor-not-allowed text-fg-disabled'
                          : day === value
                            ? 'bg-accent text-fg-on-accent hover:bg-accent-hover'
                            : 'text-fg hover:bg-card-hover',
                      ].join(' ')}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
