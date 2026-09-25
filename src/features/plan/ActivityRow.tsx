import { Delete20Regular } from '@fluentui/react-icons';
import { useId, useState } from 'react';

import { LIMITS } from '@/data/commands';
import { useUpdateActivity } from '@/data/queries';
import type { Activity, Person } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * One activity: its name, its duration in working days, and who answers for it.
 *
 * Each field is kept the moment it holds something the host can keep: a duration as soon as it
 * is a whole number of working days (or empty, which is "not known"), a responsible as soon as
 * one is picked, a name when the field is left or Enter is pressed — a name half-typed is not a
 * name. What was typed is never replaced by the host's answer while the row is on screen, so a
 * refusal leaves the typing where it was to be corrected (DESIGN_SYSTEM §8, the Defaults card).
 */
export function ActivityRow({
  activity,
  people,
  onRefused,
  onKept,
  onRemove,
}: {
  activity: Activity;
  people: readonly Person[];
  onRefused: (error: unknown) => void;
  onKept: () => void;
  onRemove: () => void;
}) {
  const { t, number } = useI18n();
  const update = useUpdateActivity();
  const hint = useId();
  const [name, setName] = useState(activity.name);
  const [nameEmpty, setNameEmpty] = useState(false);
  const [duration, setDuration] = useState(
    activity.durationDays === null ? '' : String(activity.durationDays),
  );
  const [durationInvalid, setDurationInvalid] = useState(false);
  const [responsible, setResponsible] = useState(activity.responsibleId ?? '');

  const keep = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: activity.id, patch }, { onSuccess: onKept, onError: onRefused });

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameEmpty(true);
      return;
    }
    setNameEmpty(false);
    if (trimmed !== activity.name) keep({ name: trimmed });
  };

  const editDuration = (next: string) => {
    setDuration(next);
    if (next.trim() === '') {
      setDurationInvalid(false);
      if (activity.durationDays !== null) keep({ durationDays: null });
      return;
    }
    const days = Number(next);
    if (!Number.isInteger(days) || days < 1 || days > LIMITS.durationDays) {
      setDurationInvalid(true);
      return;
    }
    setDurationInvalid(false);
    if (days !== activity.durationDays) keep({ durationDays: days });
  };

  return (
    <tr data-activity-id={activity.id} className="border-t border-stroke-subtle align-top">
      <td className="py-2">
        <Input
          aria-label={t('plan.activity.nameOf', { activity: activity.name })}
          value={name}
          maxLength={LIMITS.name}
          aria-invalid={nameEmpty}
          aria-describedby={nameEmpty ? `${hint}-name` : undefined}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitName();
            if (event.key === 'Escape') {
              setName(activity.name);
              setNameEmpty(false);
            }
          }}
        />
        {nameEmpty && (
          <span id={`${hint}-name`} className="mt-1 block text-caption text-fg-secondary">
            {t('plan.invalid.name')}
          </span>
        )}
      </td>
      <td className="py-2 pl-3">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.durationDays}
          step={1}
          data-testid="activity-duration"
          aria-label={t('plan.activity.durationOf', { activity: activity.name })}
          aria-invalid={durationInvalid}
          aria-describedby={durationInvalid ? `${hint}-duration` : undefined}
          value={duration}
          onChange={(event) => editDuration(event.target.value)}
        />
        {durationInvalid && (
          <span id={`${hint}-duration`} className="mt-1 block text-caption text-fg-secondary">
            {t('plan.invalid.duration', { max: number(LIMITS.durationDays) })}
          </span>
        )}
      </td>
      <td className="py-2 pl-3">
        <Select
          data-testid="activity-responsible"
          aria-label={t('plan.activity.responsibleOf', { activity: activity.name })}
          value={responsible}
          onChange={(event) => {
            const chosen = event.target.value;
            setResponsible(chosen);
            keep({ responsibleId: chosen === '' ? null : chosen });
          }}
        >
          <option value="">{t('plan.activity.notKnown')}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-2 pl-3 text-right">
        <Button
          appearance="subtle"
          icon={<Delete20Regular />}
          data-testid="activity-remove"
          onClick={onRemove}
        >
          {t('plan.activity.remove')}
        </Button>
      </td>
    </tr>
  );
}
