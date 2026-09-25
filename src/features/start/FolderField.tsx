import { FolderOpen20Regular } from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useId, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/**
 * Where a work lives: the operating system's folder dialog, and the path as a plain field.
 *
 * The field is a real door, not a debug hatch: a person may paste a path they copied from
 * Explorer, and the end-to-end suite types one because the system dialog cannot be driven. The
 * dialog only ever fills the field — what is in the field is what is used — so the two can never
 * disagree about which folder was chosen.
 *
 * A dialog that cannot open says so beside the field, and the field still works.
 */
export function FolderField({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  hint: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const [unavailable, setUnavailable] = useState(false);

  const choose = async () => {
    try {
      const chosen = await open({ directory: true, multiple: false });
      setUnavailable(false);
      if (typeof chosen === 'string') onChange(chosen);
    } catch {
      setUnavailable(true);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-path`} className="text-caption font-semibold text-fg-secondary">
        {t('work.field.folder')}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          id={`${id}-path`}
          data-testid="work-folder"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint`}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
        <Button icon={<FolderOpen20Regular />} onClick={() => void choose()}>
          {t('work.chooseFolder')}
        </Button>
      </div>
      <span id={`${id}-hint`} className="text-caption text-fg-tertiary">
        {unavailable ? t('work.dialogUnavailable') : hint}
      </span>
    </div>
  );
}
