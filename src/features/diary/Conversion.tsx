import type { ConvertedFrom } from '@/data/commands';
import { conversionOf } from '@/features/shell/drop';
import { useI18n } from '@/i18n/useI18n';
import { InfoBar } from '@/ui/InfoBar';

/**
 * A photo the product converts says so in words (G5, ADR-049; DESIGN_SYSTEM §8).
 *
 * A HEIC from an iPhone is kept as the JPEG Windows converts it to, under the person's own name, so
 * the copy in the work is not the file that was chosen. Two places say it, never by an icon alone:
 *
 * - `WillConvertNote`, beside the name of a photo waiting to be saved — the diary's, a check's, a
 *   snag's, a receipt's, a document's. Before the save the interface knows only the file's name, so
 *   the note follows the name (`.heic`, `.heif`, in any case); the host decides from the bytes.
 * - `ConvertedNotice`, once the host has answered: one line per file it says it converted.
 */
export function WillConvertNote({ path }: { path: string }) {
  const { t } = useI18n();
  if (conversionOf(path) === null) return null;
  return (
    <span data-testid="photo-converted-note" className="shrink-0 text-caption text-fg-secondary">
      {t('photos.convert.pending')}
    </span>
  );
}

/** A file the host kept, and what it was before it was converted, if it was. */
export interface MaybeConverted {
  readonly fileName: string;
  readonly convertedFrom: ConvertedFrom | null;
}

/**
 * What the host converted, in words: under `title` — or, without one, how many photos were
 * converted — one line per file converted, naming it and what it was. Nothing when none was.
 */
export function ConvertedNotice({
  files,
  title,
}: {
  files: readonly MaybeConverted[];
  title?: string;
}) {
  const { t, tp } = useI18n();
  const converted = files.filter(
    (file): file is MaybeConverted & { convertedFrom: ConvertedFrom } =>
      file.convertedFrom !== null,
  );
  if (converted.length === 0) return null;
  return (
    <div data-testid="photos-converted">
      <InfoBar severity="info" title={title ?? tp('photos.converted.title', converted.length)}>
        <ul className="flex flex-col gap-0.5">
          {converted.map((file, index) => (
            <li key={`${index}-${file.fileName}`} data-testid="photo-converted">
              {t('photos.converted.line', { name: file.fileName, from: file.convertedFrom })}
            </li>
          ))}
        </ul>
      </InfoBar>
    </div>
  );
}
