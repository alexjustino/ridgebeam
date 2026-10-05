import { Save20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { LIMITS } from '@/data/commands';
import { useRaiseSnag } from '@/data/queries';
import { activitiesInOrder, stagesInOrder, type WorkSnapshot } from '@/domain/plan';
import { snagsInOrder, validateSnagDraft, type SnagDraft } from '@/domain/snags';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { DateField } from '@/ui/DateField';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import { SnagPhotoField } from './SnagPhotoField';
import { snagNameCapital, snagProblemsText } from './snagWords';
import { useAddSnagPhoto } from './useAddSnagPhoto';

/**
 * Raising a snag (slice E4, decision 5): what is wrong, more about it, the stage it is in (a closed
 * one too — snags are found after closing), one of its activities or the whole stage, who must fix
 * it, the day to fix it by, and a photo of the problem. Choosing an activity puts its responsible in
 * "who must fix it" when nobody was chosen yet; it stays a choice.
 *
 * What the domain refuses (`validateSnagDraft`) is said in one list before the host is asked. The
 * photo is added to the work's documents first, attached to the work — the documents' own intake,
 * so a file the host will not keep is named with its reason under the photo field and nothing is
 * raised — and the snag is then raised naming its hash. Nothing is kept until **Raise the snag**; a
 * snag is never edited afterwards (a mistake is withdrawn with a reason).
 */
export function RaiseSnagForm({
  snapshot,
  onDone,
  onCancel,
}: {
  snapshot: WorkSnapshot;
  /** Raised: the id of the snag the host numbered. */
  onDone: (snagId: string | null) => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const raise = useRaiseSnag();
  const photo = useAddSnagPhoto(snapshot);
  const field = useId();
  const id = (name: string) => `${field}-${name}`;

  const stages = stagesInOrder(snapshot);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stageId, setStageId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [personId, setPersonId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [duePending, setDuePending] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [photoRefused, setPhotoRefused] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const activities = activitiesInOrder(snapshot).filter((each) => each.stageId === stageId);
  const busy = raise.isPending || photo.adding;

  const chooseActivity = (next: string) => {
    setActivityId(next);
    const responsible = snapshot.activities.find((each) => each.id === next)?.responsibleId ?? null;
    if (personId === '' && responsible !== null) setPersonId(responsible);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    setPhotoRefused(null);
    const draft: SnagDraft = {
      raisedOn: today,
      title: title.trim(),
      description: description.trim() === '' ? null : description.trim(),
      stageId,
      activityId: activityId === '' ? null : activityId,
      personId: personId === '' ? null : personId,
      dueOn: dueOn === '' ? null : dueOn,
      photoHash: null,
    };
    const found = snagProblemsText(i18n, term, validateSnagDraft(snapshot, draft));
    // A due day half typed is not "no due day": the field says what is wrong, and nothing is saved.
    if (duePending) found.unshift(t('snags.problem.dueUnfinished', { snag: term('snag') }));
    setProblems(found);
    if (found.length > 0) return;

    let photoHash: string | null = null;
    let checked = snapshot;
    if (path !== null) {
      const added = await photo.addPhoto(path);
      if (!added.ok) {
        setPhotoRefused(added.reason);
        return;
      }
      photoHash = added.hash;
      checked = added.snapshot;
    }
    const whole = { ...draft, photoHash };
    const late = snagProblemsText(i18n, term, validateSnagDraft(checked, whole));
    setProblems(late);
    if (late.length > 0) return;

    raise.mutate(whole, {
      onSuccess: (next) => {
        // The host numbers the snag: the one just raised is the highest.
        const raised = snagsInOrder(next).at(-1) ?? null;
        announce(
          t('snags.raised', {
            name: snagNameCapital(i18n, term, raised ?? { number: 0, title: whole.title }),
          }),
        );
        onDone(raised?.id ?? null);
      },
      onError: (error) => setRefusal(describeError(error)),
    });
  };

  return (
    <Card title={t('snags.form.title')} description={t('snags.form.lead', { snag: term('snag') })}>
      <form
        data-testid="snag-form"
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">
            {t('snags.field.title')}
          </span>
          <Input
            data-testid="snag-title"
            aria-required="true"
            maxLength={LIMITS.snagTitle}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={id('description')}
            className="text-caption font-semibold text-fg-secondary"
          >
            {t('snags.field.description')}
          </label>
          <TextArea
            id={id('description')}
            data-testid="snag-description"
            maxLength={LIMITS.snagDescription}
            aria-describedby={id('description-hint')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <span id={id('description-hint')} className="text-caption text-fg-tertiary">
            {t('snags.field.description.hint', { max: number(LIMITS.snagDescription) })}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id('stage')} className="text-caption font-semibold text-fg-secondary">
              {term('stage', { capital: true })}
            </label>
            <Select
              id={id('stage')}
              data-testid="snag-stage"
              aria-required="true"
              aria-describedby={id('stage-hint')}
              value={stageId}
              onChange={(event) => {
                setStageId(event.target.value);
                setActivityId('');
              }}
            >
              <option value="">{t('snags.field.stage.choose', { stage: term('stage') })}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
            <span id={id('stage-hint')} className="text-caption text-fg-tertiary">
              {t('snags.field.stage.hint', { stage: term('stage') })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={id('activity')}
              className="text-caption font-semibold text-fg-secondary"
            >
              {t('snags.field.activity', { activity: term('activity', { capital: true }) })}
            </label>
            <Select
              id={id('activity')}
              data-testid="snag-activity"
              value={activityId}
              onChange={(event) => chooseActivity(event.target.value)}
            >
              <option value="">{t('snags.field.activity.none', { stage: term('stage') })}</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id('person')} className="text-caption font-semibold text-fg-secondary">
              {t('snags.field.person')}
            </label>
            <Select
              id={id('person')}
              data-testid="snag-person"
              aria-describedby={id('person-hint')}
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
            >
              <option value="">{t('snags.field.person.nobody')}</option>
              {snapshot.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
            <span id={id('person-hint')} className="text-caption text-fg-tertiary">
              {t('snags.field.person.hint', {
                snag: term('snag'),
                retention: term('retention'),
              })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id('due')} className="text-caption font-semibold text-fg-secondary">
              {t('snags.field.due')}
            </label>
            <DateField
              id={id('due')}
              data-testid="snag-due"
              min={today}
              aria-describedby={id('due-hint')}
              value={dueOn}
              onChange={setDueOn}
              onPendingChange={setDuePending}
            />
            <span id={id('due-hint')} className="text-caption text-fg-tertiary">
              {t('snags.field.due.hint', { snag: term('snag') })}
            </span>
          </div>
        </div>

        <SnagPhotoField
          legend={t('snags.photo.title')}
          path={path}
          onPath={(next) => {
            setPath(next);
            setPhotoRefused(null);
          }}
          refused={photoRefused}
          pathTestId="snag-photo-path"
          addTestId="snag-photo-add"
        />

        {problems.length > 0 && (
          <div data-testid="snag-problem">
            <InfoBar severity="caution" title={t('snags.problem.title')}>
              <ul className="flex flex-col gap-0.5">
                {problems.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}
        {refusal !== null && (
          <div data-testid="snag-refused">
            <InfoBar severity="danger" title={t('snags.refused')}>
              {refusal}
            </InfoBar>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            type="submit"
            appearance="accent"
            icon={<Save20Regular />}
            data-testid="snag-save"
            disabled={busy}
          >
            {busy ? t('common.working') : t('snags.save')}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
