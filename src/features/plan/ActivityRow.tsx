import { ArrowDown20Regular, ArrowUp20Regular, Delete20Regular } from '@fluentui/react-icons';
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';

import { LIMITS } from '@/data/commands';
import { errorKind } from '@/data/errors';
import { useSetActivityRooms, useUpdateActivity } from '@/data/queries';
import type { Direction } from '@/domain/ordering';
import {
  durationRangeOf,
  type Activity,
  type Person,
  type Room,
  type WorkSnapshot,
} from '@/domain/plan';
import { DocumentsCount } from '@/features/documents/DocumentsCount';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { chordDirection } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';

/** The columns of an activity's first line, shared with the stage's column heads. */
export const ACTIVITY_COLUMNS =
  'grid grid-cols-[2.75rem_minmax(0,1fr)_7rem_11rem_auto] items-start gap-2';

/**
 * One activity, as the breakdown edits it: its number, name, duration in working days and who
 * answers for it on the first line; the rooms it touches and how much of it there is on the
 * second.
 *
 * Each field is kept the moment it holds something the host can keep — a duration as soon as it
 * is a whole number of working days, a responsible or a room as soon as one is picked, a quantity
 * as soon as it is a number, a name when the field is left. What was typed is never replaced by
 * the host's answer while the row is on screen, so a refusal leaves the typing where it was to be
 * corrected. Beside the quantity, the amount the host kept is read back in words.
 *
 * Alt+ArrowUp/Down from any control in the row moves it inside its stage; the buttons do the same.
 *
 * An activity started from a template may carry a range of working days instead of a duration (F9):
 * the range is the duration field's placeholder and its hint — "3–5" — and the field stays empty,
 * because a range is shown as a range until a person picks (DESIGN_SYSTEM §8). Nothing is invented.
 *
 * Any activity can say how uncertain it is (D1, ADR-035): **Optimistic** and **Pessimistic** working
 * days (`activity-range-min`, `activity-range-max`) on the row's second line. The pair is kept when
 * the focus leaves it — or on Enter — both or neither: one end alone is waiting for the other, said
 * under the pair and never sent; both emptied clears the range. Whether the pair holds the duration
 * between its ends is the host's to say, in its own sentence on the row. A range is not locked by
 * approval — it is an estimate of uncertainty, not the plan — so a locked plan still takes it.
 *
 * A refusal the host gives for this row is said on the row (`activity-problem`), in its words. When
 * the refusal is that the plan is approved and locked (ADR-027), the name and the duration are read
 * back from the file: nothing typed could be kept until somebody replans, and a number the plan
 * does not hold must not sit on screen looking like it does.
 */
export function ActivityRow({
  activity,
  number,
  people,
  rooms,
  outcome,
  focus,
  onFocused,
  onMove,
  onRemove,
  children,
  snapshot,
  problem = null,
}: {
  activity: Activity;
  number: string | null;
  people: readonly Person[];
  rooms: readonly Room[];
  outcome: Outcome;
  /** Asked to take the focus — from "Edit in the breakdown" on another arrangement. */
  focus: boolean;
  onFocused: () => void;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
  /** What follows the row's own fields: its links (F2). */
  children?: ReactNode;
  /** The plan, for the row's document count. */
  snapshot: WorkSnapshot;
  /** The host's refusal of an edit to this row, in its words; `null` when there is none. */
  problem?: string | null;
}) {
  const { t, number: formatNumber } = useI18n();
  const term = useTerms();
  const update = useUpdateActivity();
  const setRooms = useSetActivityRooms();
  const hint = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState(
    activity.durationDays === null ? '' : String(activity.durationDays),
  );
  const [durationInvalid, setDurationInvalid] = useState(false);
  const [rangeMin, setRangeMin] = useState(
    activity.durationMinDays === null ? '' : String(activity.durationMinDays),
  );
  const [rangeMax, setRangeMax] = useState(
    activity.durationMaxDays === null ? '' : String(activity.durationMaxDays),
  );
  const [rangeNote, setRangeNote] = useState<'invalid' | 'both' | null>(null);
  // What the pair holds as typed, kept in step with every keystroke: the focus can leave the pair in
  // the same task as the last keystroke, before a render has handed the state back.
  const typedRange = useRef({ min: rangeMin, max: rangeMax });
  const typedDuration = useRef(duration);
  const [responsible, setResponsible] = useState(activity.responsibleId ?? '');
  const [roomIds, setRoomIds] = useState<readonly string[]>(activity.roomIds);
  const [quantity, setQuantity] = useState(
    activity.quantity === null ? '' : String(activity.quantity),
  );
  const [quantityInvalid, setQuantityInvalid] = useState(false);
  const [unit, setUnit] = useState(activity.unit ?? '');
  const [unitWaits, setUnitWaits] = useState(false);
  // Bumped when a locked plan refused an edit: the name field is put back to what the file holds.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!focus) return;
    nameRef.current?.focus();
    nameRef.current?.scrollIntoView({ block: 'center' });
    onFocused();
  }, [focus, onFocused]);

  /** The range fields, read back from the file: what the plan holds, not what was typed. */
  const rangeFromFile = () => {
    const min = activity.durationMinDays === null ? '' : String(activity.durationMinDays);
    const max = activity.durationMaxDays === null ? '' : String(activity.durationMaxDays);
    typedRange.current = { min, max };
    setRangeMin(min);
    setRangeMax(max);
    setRangeNote(null);
  };

  const keep = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate(
      { id: activity.id, patch },
      {
        onSuccess: outcome.kept,
        onError: (error) => {
          outcome.refused(error);
          // A refused range is read back from the file: the host's sentence names the range and
          // the duration it would not hold together, and the pair shows what the plan keeps.
          if (patch.durationMinDays !== undefined) rangeFromFile();
          if (errorKind(error) === 'plan_approved') {
            setDuration(activity.durationDays === null ? '' : String(activity.durationDays));
            typedDuration.current =
              activity.durationDays === null ? '' : String(activity.durationDays);
            setDurationInvalid(false);
            setGeneration((now) => now + 1);
          }
        },
      },
    );

  /** A whole number of working days the host can keep, or `undefined`. */
  const readDays = (text: string): number | undefined => {
    const days = Number(text.trim());
    return Number.isInteger(days) && days >= 1 && days <= LIMITS.durationDays ? days : undefined;
  };

  /**
   * The range as typed, when it is one the host could keep and not the one the file holds — sent
   * with a duration edit so the three move together (a duration outside the old range and inside
   * the new one is kept in one patch); `null` otherwise.
   */
  const rangeTyped = (): { durationMinDays: number; durationMaxDays: number } | null => {
    const min = readDays(typedRange.current.min);
    const max = readDays(typedRange.current.max);
    if (min === undefined || max === undefined) return null;
    if (min === activity.durationMinDays && max === activity.durationMaxDays) return null;
    return { durationMinDays: min, durationMaxDays: max };
  };

  /** The duration as typed, when it is a number the file does not hold yet; `null` otherwise. */
  const durationTyped = (): number | null => {
    const days = readDays(typedDuration.current);
    return days === undefined || days === activity.durationDays ? null : days;
  };

  const editDuration = (next: string) => {
    setDuration(next);
    typedDuration.current = next;
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
    if (days !== activity.durationDays) keep({ durationDays: days, ...rangeTyped() });
  };

  /**
   * The range, kept once the focus leaves the pair: both ends, or neither. Nothing is sent while
   * one end waits for the other, or while an end is not a whole number of working days.
   */
  const keepRange = () => {
    const low = typedRange.current.min.trim();
    const high = typedRange.current.max.trim();
    if (low === '' && high === '') {
      setRangeNote(null);
      if (activity.durationMinDays !== null || activity.durationMaxDays !== null) {
        keep({ durationMinDays: null, durationMaxDays: null });
      }
      return;
    }
    if (low === '' || high === '') {
      setRangeNote('both');
      return;
    }
    const min = readDays(low);
    const max = readDays(high);
    if (min === undefined || max === undefined) {
      setRangeNote('invalid');
      return;
    }
    setRangeNote(null);
    if (min === activity.durationMinDays && max === activity.durationMaxDays) return;
    const days = durationTyped();
    keep(
      days === null
        ? { durationMinDays: min, durationMaxDays: max }
        : { durationDays: days, durationMinDays: min, durationMaxDays: max },
    );
  };

  /** Leaving the pair — not moving from one end to the other — keeps it. */
  const leaveRange = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    keepRange();
  };

  /** A quantity the host can keep, or `null` for none, or `undefined` for not a number. */
  const readQuantity = (text: string): number | null | undefined => {
    if (text.trim() === '') return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const editQuantity = (next: string) => {
    setQuantity(next);
    const value = readQuantity(next);
    if (value === undefined) {
      setQuantityInvalid(true);
      return;
    }
    setQuantityInvalid(false);
    if (value === null) {
      // No quantity, no unit: the host clears both, and so does the row.
      setUnit('');
      setUnitWaits(false);
      if (activity.quantity !== null) keep({ quantity: null });
      return;
    }
    const typedUnit = unit.trim();
    setUnitWaits(false);
    keep(typedUnit === '' ? { quantity: value } : { quantity: value, unit: typedUnit });
  };

  const editUnit = (next: string) => {
    setUnit(next);
    const typed = next.trim();
    const value = readQuantity(quantity);
    if (value === null || value === undefined) {
      // A unit needs an amount first; it waits in the field until there is one.
      setUnitWaits(typed !== '');
      return;
    }
    setUnitWaits(false);
    keep({ unit: typed === '' ? null : typed });
  };

  const toggleRoom = (roomId: string, touches: boolean) => {
    const chosen = new Set(roomIds);
    if (touches) chosen.add(roomId);
    else chosen.delete(roomId);
    // In the rooms' own order, so the set the host keeps reads the way the card lists it.
    const next = rooms.filter((room) => chosen.has(room.id)).map((room) => room.id);
    setRoomIds(next);
    setRooms.mutate(
      { id: activity.id, roomIds: next },
      { onSuccess: outcome.kept, onError: outcome.refused },
    );
  };

  const days = durationRangeOf(activity);
  const range =
    days === null
      ? null
      : t('plan.range', { min: formatNumber(days.min), max: formatNumber(days.max) });
  const durationHint = durationInvalid
    ? `${hint}-duration`
    : range === null
      ? undefined
      : `${hint}-range`;

  const kept =
    activity.quantity === null
      ? null
      : [formatNumber(activity.quantity), activity.unit ?? ''].join(' ').trim();

  return (
    <li
      data-activity-id={activity.id}
      className="flex flex-col gap-2 border-t border-stroke-subtle py-2"
      onKeyDown={(event) => {
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      <div className={ACTIVITY_COLUMNS}>
        <span data-testid="row-number" className="pt-1.5 text-body text-fg-secondary tabular-nums">
          {number ?? '—'}
        </span>
        <NameField
          key={generation}
          ref={nameRef}
          value={activity.name}
          label={t('plan.fieldOf', {
            field: term('activity', { capital: true }),
            name: activity.name,
          })}
          onCommit={(name) => keep({ name })}
        />
        <span className="flex flex-col">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.durationDays}
            step={1}
            data-testid="activity-duration"
            aria-label={t('plan.fieldOf', {
              field: term('duration', { capital: true }),
              name: activity.name,
            })}
            aria-invalid={durationInvalid}
            aria-describedby={durationHint}
            placeholder={range ?? undefined}
            value={duration}
            onChange={(event) => editDuration(event.target.value)}
          />
          {durationInvalid ? (
            <span id={`${hint}-duration`} className="mt-1 text-caption text-fg-secondary">
              {t('plan.invalid.duration', { max: formatNumber(LIMITS.durationDays) })}
            </span>
          ) : (
            range !== null && (
              <span
                id={`${hint}-range`}
                data-testid="activity-range"
                className="mt-1 text-caption text-fg-tertiary"
              >
                {t('plan.range.hint', { range })}
              </span>
            )
          )}
        </span>
        <Select
          data-testid="activity-responsible"
          aria-label={t('plan.fieldOf', {
            field: term('responsible', { capital: true }),
            name: activity.name,
          })}
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
        <span className="flex items-center gap-0.5">
          <DocumentsCount
            snapshot={snapshot}
            target={{ targetKind: 'activity', targetId: activity.id }}
            name={activity.name}
            testId="activity-documents-count"
          />
          <IconButton
            data-testid="activity-up"
            icon={<ArrowUp20Regular />}
            label={t('plan.move.up', { name: activity.name })}
            onClick={() => onMove('up')}
          />
          <IconButton
            data-testid="activity-down"
            icon={<ArrowDown20Regular />}
            label={t('plan.move.down', { name: activity.name })}
            onClick={() => onMove('down')}
          />
          <Button
            appearance="subtle"
            icon={<Delete20Regular />}
            data-testid="activity-remove"
            onClick={onRemove}
          >
            {t('plan.remove')}
          </Button>
        </span>
      </div>

      {problem !== null && (
        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
          <span aria-hidden="true" />
          <div data-testid="activity-problem">
            <InfoBar severity="caution" title={t('plan.refused')}>
              {problem}
            </InfoBar>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto_auto] items-start gap-x-4 gap-y-2">
        <span aria-hidden="true" />
        <fieldset data-testid="activity-rooms" className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1 text-caption font-semibold text-fg-tertiary">
            {term('room', { capital: true })}
          </legend>
          {rooms.length === 0 ? (
            <span className="text-caption text-fg-tertiary">
              {t('plan.rooms.noneYet', { room: term('room') })}
            </span>
          ) : (
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {rooms.map((room) => (
                <label key={room.id} className="flex items-center gap-1.5 text-body text-fg">
                  <Checkbox
                    label={room.name}
                    checked={roomIds.includes(room.id)}
                    onChange={(touches) => toggleRoom(room.id, touches)}
                  />
                  <span>{room.name}</span>
                </label>
              ))}
            </span>
          )}
        </fieldset>
        <fieldset
          data-testid="activity-range-pair"
          className="flex flex-col gap-1"
          onBlur={leaveRange}
          onKeyDown={(event) => {
            if (event.key === 'Enter') keepRange();
          }}
        >
          <legend className="mb-1 text-caption font-semibold text-fg-tertiary">
            {t('plan.range.legend', { range: term('range', { capital: true }) })}
          </legend>
          <span className="grid grid-cols-[5rem_5rem] gap-1">
            <label className="flex flex-col gap-0.5">
              <span className="text-caption text-fg-secondary">{t('plan.range.min')}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.durationDays}
                step={1}
                data-testid="activity-range-min"
                aria-label={t('plan.fieldOf', { field: t('plan.range.min'), name: activity.name })}
                aria-invalid={rangeNote === 'invalid'}
                aria-describedby={`${hint}-range-note`}
                value={rangeMin}
                onChange={(event) => {
                  typedRange.current = { ...typedRange.current, min: event.target.value };
                  setRangeMin(event.target.value);
                  setRangeNote(null);
                }}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-caption text-fg-secondary">{t('plan.range.max')}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.durationDays}
                step={1}
                data-testid="activity-range-max"
                aria-label={t('plan.fieldOf', { field: t('plan.range.max'), name: activity.name })}
                aria-invalid={rangeNote === 'invalid'}
                aria-describedby={`${hint}-range-note`}
                value={rangeMax}
                onChange={(event) => {
                  typedRange.current = { ...typedRange.current, max: event.target.value };
                  setRangeMax(event.target.value);
                  setRangeNote(null);
                }}
              />
            </label>
          </span>
          <span
            id={`${hint}-range-note`}
            className="min-h-4 max-w-[10.25rem] text-caption text-fg-tertiary"
          >
            {rangeNote === 'invalid'
              ? t('plan.invalid.range', { max: formatNumber(LIMITS.durationDays) })
              : rangeNote === 'both'
                ? t('plan.range.both')
                : ''}
          </span>
        </fieldset>
        <span className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-tertiary">
            {term('quantity', { capital: true })}
          </span>
          <span className="grid grid-cols-[6rem_5rem] gap-1">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              data-testid="activity-quantity"
              aria-label={t('plan.fieldOf', {
                field: term('quantity', { capital: true }),
                name: activity.name,
              })}
              aria-invalid={quantityInvalid}
              aria-describedby={`${hint}-quantity`}
              value={quantity}
              onChange={(event) => editQuantity(event.target.value)}
            />
            <Input
              data-testid="activity-unit"
              aria-label={t('plan.unitOf', { name: activity.name })}
              placeholder={t('plan.unit')}
              maxLength={LIMITS.unit}
              aria-describedby={`${hint}-quantity`}
              value={unit}
              onChange={(event) => editUnit(event.target.value)}
            />
          </span>
          <span id={`${hint}-quantity`} className="min-h-4 text-caption text-fg-tertiary">
            {quantityInvalid
              ? t('plan.invalid.quantity')
              : unitWaits
                ? t('plan.invalid.unitNeedsQuantity')
                : kept !== null
                  ? t('plan.quantity.kept', { amount: kept })
                  : ''}
          </span>
        </span>
      </div>
      {children}
    </li>
  );
}
