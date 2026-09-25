import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { LIMITS, type WorkDraft } from '@/data/commands';
import { useCreateWork, useOpenWork } from '@/data/queries';
import { formatWorkingDays, isIsoDay, validateCalendar } from '@/domain/calendar';
import { today } from '@/i18n/format';
import type { MessageKey } from '@/i18n/en';
import type { Language } from '@/i18n/index';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Select } from '@/ui/Select';

import { FolderField } from './FolderField';

/** The currencies F0 offers. More arrive with the money slice (F6), from the same list. */
const CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP'] as const;

/** The currency a new work starts in: the one the person's language most likely pays in. */
function defaultCurrency(language: Language): string {
  return language === 'pt-BR' ? 'BRL' : 'USD';
}

/** Monday to Friday — the working week most sites keep, and the glossary's example. */
const WEEKDAYS_ONLY = [true, true, true, true, true, false, false];

/**
 * The frame both dialogs share: the heading that names the dialog, a body that scrolls when the
 * window is short, and the row of actions that never scrolls away from it.
 */
function DialogFrame({
  title,
  lead,
  onSubmit,
  children,
  actions,
}: {
  title: string;
  lead: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  const heading = useId();
  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={heading}
      className="flex min-h-0 flex-col"
      noValidate
    >
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div>
          <h2 id={heading} className="text-subtitle font-semibold text-fg">
            {title}
          </h2>
          <p className="mt-1 text-body text-fg-secondary">{lead}</p>
        </div>
        {children}
      </div>
      <div className="flex justify-end gap-2 border-t border-stroke-subtle p-4">{actions}</div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption font-semibold text-fg-secondary">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * A new work: its name, where it is, when it starts, the currency its money is counted in, its
 * working calendar, and the folder it will live in.
 *
 * What the domain refuses is refused here, before the host is asked — a calendar with no working
 * day could never schedule anything (SPEC §6, a mandatory negative case) — and what the host
 * refuses (a folder that is not empty) is said in the host's sentence, in the window's language.
 * Nothing typed is lost to a refusal.
 */
export function NewWorkDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, language, weekdays, currency, describeError } = useI18n();
  const create = useCreateWork();
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [startDate, setStartDate] = useState(() => today());
  const [currencyCode, setCurrencyCode] = useState(() => defaultCurrency(language));
  const [workingDays, setWorkingDays] = useState<boolean[]>(WEEKDAYS_ONLY);
  const [hours, setHours] = useState('8');
  const [folder, setFolder] = useState('');
  const [problems, setProblems] = useState<MessageKey[]>([]);

  const close = () => {
    create.reset();
    setProblems([]);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hoursPerDay = Number(hours);
    const found: MessageKey[] = [];
    if (name.trim() === '') found.push('work.invalid.name');
    if (!isIsoDay(startDate)) found.push('work.invalid.start');
    const calendar = validateCalendar({ workingDays, hoursPerDay, holidays: new Set() });
    if (!calendar.ok) {
      for (const problem of calendar.problems) {
        if (problem.code === 'no-working-day') found.push('work.invalid.noWorkingDay');
        if (problem.code === 'hours-per-day') found.push('work.invalid.hours');
      }
    }
    if (folder.trim() === '') found.push('work.invalid.folder');
    setProblems(found);
    if (found.length > 0) return;

    const draft: WorkDraft = {
      name: name.trim(),
      place: place.trim(),
      startDate,
      currency: currencyCode,
      workingDays: formatWorkingDays(workingDays),
      hoursPerDay,
    };
    create.mutate(
      { folder: folder.trim(), draft },
      {
        onSuccess: () => {
          setProblems([]);
          onCreated();
        },
      },
    );
  };

  const names = weekdays('long');

  return (
    <Modal open={open} label={t('work.new.title')} onClose={close} width="lg">
      <DialogFrame
        title={t('work.new.title')}
        lead={t('work.new.lead')}
        onSubmit={submit}
        actions={
          <>
            <Button onClick={close} disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="work-create"
              disabled={create.isPending}
            >
              {create.isPending ? t('common.working') : t('work.create')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('work.field.name')}>
            {(id) => (
              <Input
                id={id}
                data-testid="work-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                maxLength={LIMITS.name}
              />
            )}
          </Field>
          <Field label={t('work.field.place')}>
            {(id) => (
              <>
                <Input
                  id={id}
                  data-testid="work-place"
                  value={place}
                  onChange={(event) => setPlace(event.target.value)}
                  autoComplete="off"
                  maxLength={LIMITS.place}
                  aria-describedby={`${id}-hint`}
                />
                <span id={`${id}-hint`} className="text-caption text-fg-tertiary">
                  {t('work.field.placeHint')}
                </span>
              </>
            )}
          </Field>
          <Field label={t('work.field.start')}>
            {(id) => (
              <Input
                id={id}
                type="date"
                data-testid="work-start"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('work.field.currency')}>
            {(id) => (
              <Select
                id={id}
                data-testid="work-currency"
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value)}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {currency(code)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-caption font-semibold text-fg-secondary">
            {t('work.field.workingDays')}
          </legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {names.map((day, index) => (
              <label key={day} className="flex items-center gap-2 text-body text-fg">
                <Checkbox
                  label={day}
                  checked={workingDays[index] === true}
                  onChange={(checked) =>
                    setWorkingDays((all) => all.map((flag, at) => (at === index ? checked : flag)))
                  }
                />
                <span>{day}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('work.field.hours')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                data-testid="work-hours"
                min={0.5}
                max={LIMITS.hoursPerDay}
                step={0.5}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
            )}
          </Field>
        </div>

        <FolderField value={folder} onChange={setFolder} hint={t('work.field.folderHintNew')} />

        {problems.length > 0 && (
          <InfoBar severity="caution" title={t('work.invalid.title')}>
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {problems.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </InfoBar>
        )}
        {create.isError && (
          <InfoBar severity="danger" title={t('work.createRefused')}>
            {describeError(create.error)}
          </InfoBar>
        )}
      </DialogFrame>
    </Modal>
  );
}

/**
 * Open a work that already exists: the folder that holds it, and nothing else. A folder with no
 * work in it, or one that is gone, is refused in the host's sentence.
 */
export function OpenWorkDialog({
  open,
  initialFolder,
  onClose,
  onOpened,
}: {
  open: boolean;
  initialFolder: string;
  onClose: () => void;
  onOpened: () => void;
}) {
  const { t, describeError } = useI18n();
  const openWork = useOpenWork();
  const [folder, setFolder] = useState(initialFolder);
  const [problem, setProblem] = useState(false);

  const close = () => {
    openWork.reset();
    setProblem(false);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (folder.trim() === '') {
      setProblem(true);
      return;
    }
    setProblem(false);
    openWork.mutate(folder.trim(), { onSuccess: onOpened });
  };

  return (
    <Modal open={open} label={t('work.open.title')} onClose={close}>
      <DialogFrame
        title={t('work.open.title')}
        lead={t('work.open.lead')}
        onSubmit={submit}
        actions={
          <>
            <Button onClick={close} disabled={openWork.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="work-open"
              disabled={openWork.isPending}
            >
              {openWork.isPending ? t('common.working') : t('work.openSubmit')}
            </Button>
          </>
        }
      >
        <FolderField value={folder} onChange={setFolder} hint={t('work.field.folderHintOpen')} />
        {problem && (
          <InfoBar severity="caution" title={t('work.invalid.title')}>
            {t('work.invalid.folder')}
          </InfoBar>
        )}
        {openWork.isError && (
          <InfoBar severity="danger" title={t('work.openRefused')}>
            {describeError(openWork.error)}
          </InfoBar>
        )}
      </DialogFrame>
    </Modal>
  );
}
