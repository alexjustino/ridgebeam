import { roomsInOrder, stagesInOrder, type WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Select } from '@/ui/Select';

import { targetValue } from './aftercareWords';

/**
 * What a warranty or a maintenance task covers (slice G4): the whole work, one room or one stage —
 * the same three a care note is written on — in the plan's order, rooms and stages each under their
 * own heading.
 */
export function AftercareTargetSelect({
  snapshot,
  id,
  testId,
  value,
  onChange,
}: {
  snapshot: WorkSnapshot;
  id: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const rooms = roomsInOrder(snapshot);
  const stages = stagesInOrder(snapshot);

  return (
    <Select
      id={id}
      data-testid={testId}
      aria-required="true"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={targetValue('work', snapshot.work.workId)}>
        {t('aftercare.target.work')}
      </option>
      {rooms.length > 0 && (
        <optgroup label={term('room', { capital: true })}>
          {rooms.map((room) => (
            <option key={room.id} value={targetValue('room', room.id)}>
              {room.name}
            </option>
          ))}
        </optgroup>
      )}
      {stages.length > 0 && (
        <optgroup label={term('stage', { capital: true })}>
          {stages.map((stage) => (
            <option key={stage.id} value={targetValue('stage', stage.id)}>
              {stage.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
