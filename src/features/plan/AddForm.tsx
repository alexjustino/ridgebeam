import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { LIMITS } from '@/data/commands';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/** A name and a button, submitted by the button or by Enter. An empty name is said, not sent. */
export function AddForm({
  label,
  inputTestId,
  buttonTestId,
  buttonLabel,
  icon,
  pending,
  onAdd,
}: {
  label: string;
  inputTestId: string;
  buttonTestId: string;
  buttonLabel: string;
  icon: ReactNode;
  pending: boolean;
  onAdd: (name: string, done: () => void) => void;
}) {
  const { t } = useI18n();
  const hint = useId();
  const [name, setName] = useState('');
  const [empty, setEmpty] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    onAdd(name.trim(), () => setName(''));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" noValidate>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          data-testid={inputTestId}
          aria-label={label}
          placeholder={label}
          aria-invalid={empty}
          aria-describedby={empty ? hint : undefined}
          value={name}
          maxLength={LIMITS.name}
          onChange={(event) => {
            setName(event.target.value);
            if (empty) setEmpty(false);
          }}
        />
        <Button type="submit" icon={icon} data-testid={buttonTestId} disabled={pending}>
          {buttonLabel}
        </Button>
      </div>
      {empty && (
        <span id={hint} className="text-caption text-fg-secondary">
          {t('plan.invalid.name')}
        </span>
      )}
    </form>
  );
}
