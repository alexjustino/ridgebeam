import { Add20Regular, Dismiss16Regular, ImageAdd20Regular } from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useId, useRef, useState } from 'react';

import { WillConvertNote } from '@/features/diary/Conversion';
import { baseName, PHOTO_EXTENSIONS } from '@/features/shell/drop';
import { useDropTarget } from '@/features/shell/dropTarget';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/**
 * One photo for a snag (slice E4): the photo of the problem when it is raised, the photo of it fixed
 * when it is closed. Chosen the three ways a photo is chosen elsewhere — **Choose a photo…** (the
 * system's dialog), a path typed or pasted and **Add**, or dropped on the window (U1: drop is
 * choose) — and shown by name before anything is kept, with a button that takes it out. A snag takes
 * one photo: a second one chosen replaces the first, and a drop of several takes the first and names
 * the others as left out. Nothing reaches the work until the form's own button is pressed; then the
 * file goes through the documents' intake (`useAddSnagPhoto`), and a refusal is the host's sentence
 * under this field (`refused`), naming the file.
 */
export function SnagPhotoField({
  legend,
  path,
  onPath,
  refused,
  pathTestId,
  addTestId,
}: {
  legend: string;
  path: string | null;
  onPath: (path: string | null) => void;
  /** The host's sentence for the photo it would not keep; `null` when there is none. */
  refused: string | null;
  pathTestId: string;
  addTestId: string;
}) {
  const { t, tp } = useI18n();
  const hint = useId();
  const field = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [dialogFailed, setDialogFailed] = useState(false);
  const [left, setLeft] = useState<readonly string[]>([]);
  const [extra, setExtra] = useState<readonly string[]>([]);

  // Files dropped on the Plan while this field is on screen are chosen photos: the first is taken.
  useDropTarget('snag', (taken, refusedNames) => {
    const [first, ...rest] = taken;
    setLeft(refusedNames);
    setExtra(rest.map((each) => baseName(each)));
    if (first !== undefined) {
      onPath(first);
      announce(t('snags.photo.chosen', { name: baseName(first) }));
    }
    if (refusedNames.length > 0) {
      announce(tp('drop.left', refusedNames.length, { names: refusedNames.join(', ') }));
    }
  });

  const choose = async () => {
    try {
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: t('diary.photos.title'), extensions: [...PHOTO_EXTENSIONS] }],
      });
      setDialogFailed(false);
      setLeft([]);
      setExtra([]);
      const picked = chosen === null ? null : Array.isArray(chosen) ? (chosen[0] ?? null) : chosen;
      if (picked !== null) onPath(picked);
    } catch {
      setDialogFailed(true);
    }
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-caption font-semibold text-fg-secondary">{legend}</legend>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
        <Button icon={<ImageAdd20Regular />} onClick={() => void choose()}>
          {t('snags.photo.choose')}
        </Button>
        <Input
          ref={field}
          data-testid={pathTestId}
          aria-label={t('diary.photos.path')}
          aria-describedby={hint}
          placeholder={t('diary.photos.path')}
          className="font-mono"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button
          icon={<Add20Regular />}
          data-testid={addTestId}
          onClick={() => {
            const trimmed = typed.trim();
            if (trimmed !== '') {
              onPath(trimmed);
              setLeft([]);
              setExtra([]);
            }
            setTyped('');
          }}
        >
          {t('diary.photos.add')}
        </Button>
      </div>
      <span id={hint} className="text-caption text-fg-tertiary">
        {dialogFailed ? t('diary.photos.dialogUnavailable') : t('snags.photo.hint')}
      </span>
      {path !== null && (
        <div data-pending-photo={path} className="flex items-center gap-2 text-body text-fg">
          <span className="min-w-0 flex-1 truncate">
            {t('snags.photo.chosen', { name: baseName(path) })}
          </span>
          <WillConvertNote path={path} />
          <button
            type="button"
            aria-label={t('diary.photos.remove', { name: baseName(path) })}
            title={t('diary.photos.remove', { name: baseName(path) })}
            onClick={() => {
              // The button removes itself: the focus goes to the path field.
              onPath(null);
              window.requestAnimationFrame(() => field.current?.focus());
            }}
            className="grid size-6 place-items-center rounded-sm text-fg-secondary transition-colors duration-100 ease-easy hover:bg-card-hover"
          >
            <Dismiss16Regular aria-hidden="true" />
          </button>
        </div>
      )}
      {left.length > 0 && (
        <p className="text-body text-fg">
          {tp('drop.left', left.length, { names: left.join(', ') })}
        </p>
      )}
      {extra.length > 0 && (
        <p className="text-body text-fg">
          {tp('snags.photo.onlyOne', extra.length, { names: extra.join(', ') })}
        </p>
      )}
      {refused !== null && (
        <p data-testid="snag-photo-refused" className="text-body font-semibold text-fg">
          {refused}
        </p>
      )}
    </fieldset>
  );
}
