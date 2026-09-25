import {
  Add20Regular,
  Dismiss16Regular,
  ImageAdd20Regular,
  Save20Regular,
} from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { LIMITS } from '@/data/commands';
import { useAddEntry } from '@/data/queries';
import {
  progress,
  validateDraft,
  WEATHER,
  type DiaryEntry,
  type DoneLine,
  type DraftProblem,
  type EntryDraft,
  type Weather,
} from '@/domain/diary';
import { activitiesInOrder, type Activity, type WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { TextArea } from '@/ui/TextArea';

import { WEATHER_KEYS } from './weather';

const PROBLEM_KEYS: Record<DraftProblem['code'], MessageKey> = {
  'invalid-day': 'diary.problem.invalidDay',
  'future-day': 'diary.problem.futureDay',
  'unknown-activity': 'diary.problem.unknownActivity',
  'unknown-person': 'diary.problem.unknownPerson',
  'correction-without-seq': 'diary.problem.correctsUnknown',
  'entry-with-corrects': 'diary.problem.correctsUnknown',
  'corrects-unknown': 'diary.problem.correctsUnknown',
  'correction-note-empty': 'diary.problem.correctionNote',
  'negative-quantity': 'diary.problem.negativeQuantity',
  'worked-and-finished': 'diary.problem.workedAndFinished',
  'duplicate-activity': 'diary.problem.duplicate',
  'invalid-weather': 'diary.problem.weather',
  'invalid-hours': 'diary.problem.hours',
  'too-long': 'diary.problem.tooLong',
};

interface DoneMark {
  worked: boolean;
  finished: boolean;
  quantity: string;
}

/** The last part of a path, whichever separator the person's system uses. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * One entry of the diary: one press for the usual day, more fields when the day asks for them.
 *
 * On top, what is on site: the activities running on the day (from the schedule) or already
 * started (from the diary) as "worked on", each with "finished"; the people present as chips; the
 * weather. Behind "More…": the note, the hours, a lost day, deliveries, incidents, visitors and
 * photos — chosen in the system's dialog or typed as a path, listed before anything is saved, and
 * copied into the work by the host only when the entry is written.
 *
 * As a correction it opens with everything the corrected entry said and one field more that must
 * be filled: what was wrong. A correction restates the whole day, so nothing is patched; the
 * original stays in the diary, struck through (ADR-019). The domain checks the draft first — a day
 * in the future is refused with a sentence before the host is asked, and so is a correction with
 * no reason — and the host refuses what it must (a photo that is not a photo) in its own words.
 */
export function EntryForm({
  snapshot,
  scheduled,
  entries,
  today,
  correcting,
  onDone,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  entries: readonly DiaryEntry[];
  today: string;
  /** The entry being corrected, or `null` for a new entry. */
  correcting: DiaryEntry | null;
  onDone: () => void;
}) {
  const { t, describeError } = useI18n();
  const add = useAddEntry();
  const ids = useId();
  const correction = correcting !== null;

  const [day, setDay] = useState(correcting?.day ?? today);
  const [marks, setMarks] = useState<Map<string, DoneMark>>(
    () =>
      new Map(
        (correcting?.done ?? []).map((line) => [
          line.activityId,
          {
            worked: true,
            finished: line.state === 'finished',
            quantity: line.quantity === null ? '' : String(line.quantity),
          },
        ]),
      ),
  );
  const [present, setPresent] = useState<Set<string>>(() => new Set(correcting?.present ?? []));
  const [weather, setWeather] = useState<Weather | null>(correcting?.weather ?? null);
  const [more, setMore] = useState(correction);
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(
    correcting?.hours === null || correcting === null ? '' : String(correcting.hours),
  );
  const [lostDay, setLostDay] = useState(correcting?.lostDay ?? false);
  const [deliveries, setDeliveries] = useState(correcting?.deliveries ?? '');
  const [incidents, setIncidents] = useState(correcting?.incidents ?? '');
  const [visitors, setVisitors] = useState(correcting?.visitors ?? '');
  const [paths, setPaths] = useState<string[]>([]);
  const [kept, setKept] = useState<string[]>(() =>
    (correcting?.photos ?? []).map((photo) => photo.fileHash),
  );
  const [pathField, setPathField] = useState('');
  const [dialogFailed, setDialogFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const ordered = activitiesInOrder(snapshot);
  const started = useMemo(() => progress(snapshot, entries), [snapshot, entries]);
  const running = ordered.filter((activity) => {
    if (marks.has(activity.id)) return true;
    const dates = scheduled.dates.get(activity.id);
    if (dates !== undefined && dates.start <= day && day <= dates.finish) return true;
    return started.get(activity.id)?.state === 'started';
  });
  // A form with nothing on it offers nothing to press: when nothing is running, every activity is.
  const listed: Activity[] = showAll || running.length === 0 ? ordered : running;
  const keptPhotos = (correcting?.photos ?? []).filter((photo) => kept.includes(photo.fileHash));

  const mark = (activityId: string, change: Partial<DoneMark>) =>
    setMarks((all) => {
      const next = new Map(all);
      const now = next.get(activityId) ?? { worked: false, finished: false, quantity: '' };
      const merged = { ...now, ...change };
      // Finished is worked on, too; not worked on is not finished either.
      if (change.finished === true) merged.worked = true;
      if (change.worked === false) merged.finished = false;
      if (!merged.worked && !merged.finished && merged.quantity === '') next.delete(activityId);
      else next.set(activityId, merged);
      return next;
    });

  const choosePhotos = async () => {
    try {
      const chosen = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: t('diary.photos.title'),
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
          },
        ],
      });
      setDialogFailed(false);
      const list = chosen === null ? [] : Array.isArray(chosen) ? chosen : [chosen];
      setPaths((all) => [...all, ...list.filter((path) => !all.includes(path))]);
    } catch {
      setDialogFailed(true);
    }
  };

  const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const done: DoneLine[] = [...marks.entries()]
      .filter(([, value]) => value.worked || value.finished)
      .map(([activityId, value]) => ({
        activityId,
        state: value.finished ? 'finished' : 'worked',
        quantity: value.quantity.trim() === '' ? null : Number(value.quantity),
        note: null,
      }));
    const draft: EntryDraft = {
      day,
      kind: correction ? 'correction' : 'entry',
      correctsSeq: correcting?.seq ?? null,
      // The host keeps the note as text, never null: an entry with nothing to say says ''.
      note: note.trim(),
      weather,
      lostDay,
      hours: hours.trim() === '' ? null : Number(hours),
      deliveries: text(deliveries),
      incidents: text(incidents),
      visitors: text(visitors),
      done,
      present: [...present],
      photoPaths: paths,
      photoHashes: kept,
    };
    const found = validateDraft(draft, today, snapshot, entries);
    if (found.length > 0) {
      setProblems([...new Set(found.map((problem) => t(PROBLEM_KEYS[problem.code])))]);
      return;
    }
    setProblems([]);
    add.mutate(draft, {
      onSuccess: (entry) => {
        announce(t('diary.saved', { seq: entry.seq }));
        setMarks(new Map());
        setPresent(new Set());
        setWeather(null);
        setNote('');
        setHours('');
        setLostDay(false);
        setDeliveries('');
        setIncidents('');
        setVisitors('');
        setPaths([]);
        setPathField('');
        onDone();
      },
      onError: (error) => setProblems([describeError(error)]),
    });
  };

  const weatherLabels = Object.fromEntries(
    WEATHER.map((each) => [each, t(WEATHER_KEYS[each])]),
  ) as Record<Weather, string>;

  return (
    <Card
      title={
        correction ? t('diary.correction.title', { seq: correcting.seq }) : t('diary.form.title')
      }
      {...(correction ? { description: t('diary.correction.explain') } : {})}
    >
      <form data-testid="entry-today" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <label className="flex max-w-56 flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">
            {t('diary.form.day')}
          </span>
          <Input
            type="date"
            data-testid="entry-day"
            max={today}
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-caption font-semibold text-fg-secondary">
            {running.length === 0 || showAll ? t('diary.form.worked') : t('diary.form.running')}
          </legend>
          {running.length === 0 && ordered.length > 0 && (
            <p className="text-caption text-fg-tertiary">{t('diary.form.none')}</p>
          )}
          <ul className="flex flex-col gap-1">
            {listed.map((activity) => {
              const value = marks.get(activity.id);
              return (
                <li
                  key={activity.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3"
                >
                  <label className="flex min-w-0 items-center gap-2 text-body text-fg">
                    <Checkbox
                      testId={`entry-done-${activity.id}`}
                      label={t('diary.form.workedOn', { name: activity.name })}
                      checked={value?.worked ?? false}
                      onChange={(checked) => mark(activity.id, { worked: checked })}
                    />
                    <span className="truncate">{activity.name}</span>
                  </label>
                  <label className="flex items-center gap-2 text-body text-fg-secondary">
                    <Checkbox
                      testId={`entry-finished-${activity.id}`}
                      label={t('diary.form.finishedOn', { name: activity.name })}
                      checked={value?.finished ?? false}
                      onChange={(checked) => mark(activity.id, { finished: checked })}
                    />
                    <span>{t('diary.form.finished')}</span>
                  </label>
                  {activity.quantity !== null && activity.unit !== null ? (
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      className="w-24"
                      data-testid={`entry-quantity-${activity.id}`}
                      aria-label={t('diary.form.quantityOf', {
                        name: activity.name,
                        unit: activity.unit,
                      })}
                      placeholder={activity.unit}
                      value={value?.quantity ?? ''}
                      onChange={(event) => mark(activity.id, { quantity: event.target.value })}
                    />
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
          {running.length > 0 && running.length < ordered.length && (
            <div>
              <Button appearance="subtle" onClick={() => setShowAll((now) => !now)}>
                {showAll ? t('diary.form.showRunning') : t('diary.form.showAll')}
              </Button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-caption font-semibold text-fg-secondary">
            {t('diary.form.present')}
          </legend>
          {snapshot.people.length === 0 ? (
            <p className="text-caption text-fg-tertiary">{t('diary.form.noPeople')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {snapshot.people.map((person) => {
                const here = present.has(person.id);
                return (
                  <li key={person.id}>
                    <Button
                      appearance={here ? 'accent' : 'standard'}
                      aria-pressed={here}
                      data-testid={`entry-present-${person.id}`}
                      onClick={() =>
                        setPresent((all) => {
                          const next = new Set(all);
                          if (next.has(person.id)) next.delete(person.id);
                          else next.add(person.id);
                          return next;
                        })
                      }
                    >
                      {person.name}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <div data-testid="entry-weather">
          <ChoiceGroup
            label={t('diary.form.weather')}
            options={WEATHER}
            value={weather}
            labels={weatherLabels}
            onChange={(next: Weather) => setWeather((now) => (now === next ? null : next))}
          />
        </div>

        <div>
          <Button
            appearance="subtle"
            data-testid="entry-more"
            aria-expanded={more}
            aria-controls={`${ids}-more`}
            onClick={() => setMore((now) => !now)}
          >
            {more ? t('diary.form.less') : t('diary.form.more')}
          </Button>
        </div>

        {more && (
          <div id={`${ids}-more`} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-caption font-semibold text-fg-secondary">
                {correction ? t('diary.correction.note') : t('diary.form.note')}
              </span>
              <TextArea
                data-testid={correction ? 'correction-note' : 'entry-note'}
                aria-required={correction}
                maxLength={LIMITS.entryNote}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-caption font-semibold text-fg-secondary">
                  {t('diary.form.hours')}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={24}
                  step={0.5}
                  data-testid="entry-hours"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 self-end pb-1.5 text-body text-fg">
                <Checkbox
                  testId="entry-lost-day"
                  label={t('diary.form.lostDay')}
                  checked={lostDay}
                  onChange={setLostDay}
                />
                <span>{t('diary.form.lostDay')}</span>
              </label>
            </div>
            {(
              [
                ['entry-deliveries', 'diary.form.deliveries', deliveries, setDeliveries],
                ['entry-incidents', 'diary.form.incidents', incidents, setIncidents],
                ['entry-visitors', 'diary.form.visitors', visitors, setVisitors],
              ] as const
            ).map(([testId, labelKey, value, set]) => (
              <label key={testId} className="flex flex-col gap-1">
                <span className="text-caption font-semibold text-fg-secondary">{t(labelKey)}</span>
                <TextArea
                  data-testid={testId}
                  className="min-h-16"
                  maxLength={LIMITS.entryText}
                  value={value}
                  onChange={(event) => set(event.target.value)}
                />
              </label>
            ))}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-caption font-semibold text-fg-secondary">
                {t('diary.photos.title')}
              </legend>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
                <Button icon={<ImageAdd20Regular />} onClick={() => void choosePhotos()}>
                  {t('diary.photos.choose')}
                </Button>
                <Input
                  data-testid="entry-photo-path"
                  aria-label={t('diary.photos.path')}
                  placeholder={t('diary.photos.path')}
                  className="font-mono"
                  spellCheck={false}
                  value={pathField}
                  onChange={(event) => setPathField(event.target.value)}
                />
                <Button
                  icon={<Add20Regular />}
                  data-testid="entry-photo-add"
                  onClick={() => {
                    const path = pathField.trim();
                    if (path !== '' && !paths.includes(path)) setPaths((all) => [...all, path]);
                    setPathField('');
                  }}
                >
                  {t('diary.photos.add')}
                </Button>
              </div>
              <span className="text-caption text-fg-tertiary">
                {dialogFailed ? t('diary.photos.dialogUnavailable') : t('diary.photos.hint')}
              </span>
              {(paths.length > 0 || keptPhotos.length > 0) && (
                <ul className="flex flex-col gap-1">
                  {keptPhotos.map((photo) => (
                    <li
                      key={photo.fileHash}
                      data-kept-photo={photo.fileHash}
                      className="flex items-center gap-2 text-body text-fg"
                    >
                      <span className="min-w-0 flex-1 truncate">{photo.fileName}</span>
                      <span className="text-caption text-fg-tertiary">
                        {t('diary.photos.kept')}
                      </span>
                      <PendingRemove
                        label={t('diary.photos.remove', { name: photo.fileName })}
                        onRemove={() =>
                          setKept((all) => all.filter((hash) => hash !== photo.fileHash))
                        }
                      />
                    </li>
                  ))}
                  {paths.map((path) => (
                    <li
                      key={path}
                      data-pending-photo={path}
                      className="flex items-center gap-2 text-body text-fg"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-caption">{path}</span>
                      <PendingRemove
                        label={t('diary.photos.remove', { name: fileName(path) })}
                        onRemove={() => setPaths((all) => all.filter((each) => each !== path))}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          </div>
        )}

        {problems.length > 0 && (
          <div data-testid="entry-problem">
            <InfoBar severity="caution" title={t('diary.problem.title')}>
              <ul className="flex flex-col gap-0.5">
                {problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            appearance="accent"
            icon={<Save20Regular />}
            data-testid="entry-save"
            disabled={add.isPending}
          >
            {add.isPending
              ? t('common.working')
              : correction
                ? t('diary.save.correction')
                : day === today
                  ? t('diary.save.today')
                  : t('diary.save.entry')}
          </Button>
          {correction && (
            <Button onClick={onDone} disabled={add.isPending}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function PendingRemove({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onRemove}
      className="grid size-6 place-items-center rounded-sm text-fg-secondary transition-colors duration-100 ease-easy hover:bg-card-hover"
    >
      <Dismiss16Regular aria-hidden="true" />
    </button>
  );
}
