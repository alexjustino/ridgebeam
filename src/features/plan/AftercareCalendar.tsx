import {
  CalendarAdd20Regular,
  ShieldDismiss16Regular,
  Warning16Regular,
  Wrench16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToday } from '@/app/today';
import type { WrittenFile } from '@/data/commands';
import { useWriteAftercareIcs } from '@/data/queries';
import {
  aftercareCalendar,
  aftercareIcs,
  AFTERCARE_CALENDAR_KEYS,
  type AftercareCalendarItem,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import { keyFrom } from '@/domain/templates/export';
import { PathForm, ProblemBar } from '@/features/reports/PathForm';
import { useSaveTarget } from '@/features/reports/useSaveTarget';
import type { MessageKey } from '@/i18n/en';
import { formatMonth } from '@/i18n/format';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';

import { aftercareIcsWords, aftercareTargetText, overdueText } from './aftercareWords';

/** A month's name as a heading: its first letter in capitals ("outubro de 2026" → "Outubro de 2026"). */
function capitalised(text: string, language: string): string {
  return text.slice(0, 1).toLocaleUpperCase(language) + text.slice(1);
}

/**
 * **What comes due** (`aftercare-calendar`, slice G4, decision 3), on the Handover tab under the
 * warranties and the maintenance: the next twelve months as a list, not a grid — each month a heading
 * over its items in day order, each item an icon and words for its kind (_maintenance due_,
 * _warranty ends_), its day, what it covers, and _overdue_ in words where it is. A task already
 * overdue is listed in the current month. **A month with nothing due says so** (DESIGN_SYSTEM §8).
 *
 * **Add to your calendar…** (`aftercare-ics`) opens a dialog that writes the same days as an `.ics`
 * file for the person's own calendar to remind them; Ridgebeam reminds nobody.
 *
 * `focus` (the dashboard's After the handover card asked for it) scrolls the calendar into view and
 * puts the focus on its heading, once.
 */
export function AftercareCalendar({
  snapshot,
  focus = false,
  onFocused,
}: {
  snapshot: WorkSnapshot;
  focus?: boolean;
  onFocused?: (() => void) | undefined;
}) {
  const i18n = useI18n();
  const { t, day, language } = i18n;
  const today = useToday();
  const heading = useRef<HTMLHeadingElement>(null);
  const [writing, setWriting] = useState(false);
  const months = useMemo(() => aftercareCalendar(snapshot, today, 12), [snapshot, today]);
  const anything = snapshot.warranties.length > 0 || snapshot.maintenance.length > 0;

  useEffect(() => {
    if (!focus) return;
    heading.current?.scrollIntoView?.({ block: 'start' });
    heading.current?.focus();
    onFocused?.();
  }, [focus, onFocused]);

  return (
    <div data-testid="aftercare-calendar">
      <Card>
        <header className="mb-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 ref={heading} tabIndex={-1} className="text-body-lg font-semibold text-fg">
              {t('aftercare.calendar.title')}
            </h2>
            <p className="mt-0.5 text-caption text-fg-tertiary">{t('aftercare.calendar.lead')}</p>
          </div>
          {anything && (
            <Button
              icon={<CalendarAdd20Regular />}
              data-testid="aftercare-ics"
              className="shrink-0"
              onClick={() => setWriting(true)}
            >
              {t('aftercare.ics.open')}
            </Button>
          )}
        </header>
        {!anything ? (
          <p data-testid="aftercare-calendar-nothing" className="text-body text-fg-tertiary">
            {t('aftercare.calendar.nothing')}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {months.map((month) => (
              <li
                key={month.month}
                data-month={month.month}
                data-empty={month.empty ? 'true' : 'false'}
                className="flex flex-col gap-1 border-t border-stroke-subtle pt-2 first:border-t-0 first:pt-0"
              >
                <h3 className="text-body font-semibold text-fg">
                  {capitalised(formatMonth(language, month.firstDay), language)}
                </h3>
                {month.empty ? (
                  <p data-testid="aftercare-month-empty" className="text-body text-fg-tertiary">
                    {t(AFTERCARE_CALENDAR_KEYS.empty as MessageKey)}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {month.items.map((item) => (
                      <CalendarItem key={item.key} item={item} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-caption text-fg-tertiary">
          {t('aftercare.calendar.asOf', { day: day(today) })}
        </p>
      </Card>
      {writing && <IcsDialog snapshot={snapshot} onClose={() => setWriting(false)} />}
    </div>
  );
}

function CalendarItem({ item }: { item: AftercareCalendarItem }) {
  const i18n = useI18n();
  const { t, day } = i18n;
  return (
    <li
      data-calendar-item={item.key}
      data-kind={item.kind}
      data-overdue={item.overdue ? 'true' : 'false'}
      data-day={item.day}
      className="flex items-start gap-2 text-body text-fg"
    >
      <span aria-hidden="true" className="inline-grid pt-0.5 text-fg-secondary">
        {item.kind === 'task-due' ? <Wrench16Regular /> : <ShieldDismiss16Regular />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{t(item.messageKey as MessageKey)}</span>
        <span aria-hidden="true"> — </span>
        <span>{item.title}</span>
        <span aria-hidden="true"> — </span>
        <span className="text-fg-secondary">{aftercareTargetText(i18n, item)}</span>
        <span aria-hidden="true"> — </span>
        <span>{day(item.day)}</span>
        {item.overdue && (
          <span
            data-testid="aftercare-item-overdue"
            className="ml-2 inline-flex items-center gap-1 rounded-md bg-caution-subtle px-2 py-0.5 text-caption text-fg"
          >
            <Warning16Regular aria-hidden="true" className="text-caution" />
            {item.daysOverdue === null
              ? t(AFTERCARE_CALENDAR_KEYS.overdue as MessageKey)
              : overdueText(i18n, item.daysOverdue)}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Writing the calendar file: what it is, in one sentence — the same days, for the person's own
 * calendar to remind them, written again to update it, holding nothing but what was typed here —
 * then the path field with **Choose…** (the save dialog, `.ics`) and the button that writes it. Done,
 * it says where the file went (`aftercare-ics-done`); the product does not open it.
 */
function IcsDialog({ snapshot, onClose }: { snapshot: WorkSnapshot; onClose: () => void }) {
  const i18n = useI18n();
  const { t, describeError } = i18n;
  const today = useToday();
  const write = useWriteAftercareIcs();
  const suggested = useCallback(
    () => t('aftercare.ics.file', { work: keyFrom(snapshot.work.name, 'work') }),
    [snapshot.work.name, t],
  );
  const target = useSaveTarget('ics', suggested);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<WrittenFile | null>(null);
  const title = t('aftercare.ics.title');

  const submit = () => {
    setProblem(null);
    setDone(null);
    const where = target.target();
    if (!where.ok) {
      setProblem(where.problem);
      return;
    }
    const text = aftercareIcs(
      snapshot,
      aftercareIcsWords(i18n, snapshot),
      new Date().toISOString(),
      today,
    );
    write.mutate(
      { path: where.path, text, overwrite: where.overwrite },
      {
        onSuccess: setDone,
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  return (
    <Modal open label={title} onClose={write.isPending ? () => undefined : onClose}>
      <div data-testid="aftercare-ics-dialog" className="flex flex-col gap-4 p-5">
        <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
        <p className="text-body text-fg-secondary">{t('aftercare.ics.body')}</p>
        <PathForm
          target={target}
          testId="aftercare-ics-path"
          writeTestId="aftercare-ics-write"
          writeLabel={t('aftercare.ics.write')}
          writing={write.isPending}
          onEdited={() => {
            setProblem(null);
            setDone(null);
          }}
          onWrite={submit}
        />
        {problem !== null && <ProblemBar testId="aftercare-ics-problem" problem={problem} />}
        {done !== null && (
          <div data-testid="aftercare-ics-done">
            <InfoBar severity="success" title={t('aftercare.ics.done')}>
              <p>
                <span data-selectable className="font-mono break-all">
                  {done.path}
                </span>
              </p>
              <p className="mt-1">{t('aftercare.ics.doneHow')}</p>
            </InfoBar>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose} disabled={write.isPending}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
