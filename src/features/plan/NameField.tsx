import { useId, useState, type Ref } from 'react';

import { LIMITS } from '@/data/commands';
import { useI18n } from '@/i18n/useI18n';
import { Input } from '@/ui/Input';

/**
 * A name edited in place: kept when the field is left or Enter is pressed — a name half-typed is
 * not a name — put back by Escape, and refused with a sentence when it is empty. What was typed
 * stays on screen after a refusal, to be corrected.
 */
export function NameField({
  value,
  label,
  onCommit,
  onCancel,
  testId,
  ref,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
  onCancel?: () => void;
  testId?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const { t } = useI18n();
  const hint = useId();
  const [name, setName] = useState(value);
  const [empty, setEmpty] = useState(false);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    if (trimmed !== value) onCommit(trimmed);
    else onCancel?.();
  };

  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <Input
        ref={ref}
        data-testid={testId}
        aria-label={label}
        value={name}
        maxLength={LIMITS.name}
        aria-invalid={empty}
        aria-describedby={empty ? hint : undefined}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            setName(value);
            setEmpty(false);
            onCancel?.();
          }
        }}
      />
      {empty && (
        <span id={hint} className="mt-1 text-caption text-fg-secondary">
          {t('plan.invalid.name')}
        </span>
      )}
    </span>
  );
}
