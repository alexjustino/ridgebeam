import { Open16Regular } from '@fluentui/react-icons';

import { useOpenPhoto, usePhotoThumbnail } from '@/data/queries';
import type { Photo } from '@/domain/diary';
import { useI18n } from '@/i18n/useI18n';

/**
 * A photo the work owns, as a thumbnail: an `<img>` whose source is a `data:` URL the host made
 * from its own 320 px copy — no file path ever reaches the page, and nothing the photo carried is
 * injected into markup (ADR-021). Pressing it asks the host to open the original with the
 * operating system's own handler. A photo whose thumbnail could not be made is still kept, and
 * says so instead of showing a broken image.
 */
export function PhotoThumb({
  photo,
  day,
  size = 'md',
}: {
  photo: Photo;
  day: string;
  size?: 'sm' | 'md';
}) {
  const { t, day: formatDay } = useI18n();
  const thumbnail = usePhotoThumbnail(photo.fileHash, photo.thumbnail);
  const open = useOpenPhoto();
  const box = size === 'sm' ? 'size-16' : 'size-24';

  return (
    <figure data-photo-hash={photo.fileHash} className="flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid="photo-open"
        aria-label={t('diary.photo.open', { name: photo.fileName })}
        title={t('diary.photo.open', { name: photo.fileName })}
        onClick={() => open.mutate(photo.fileHash)}
        className={`relative grid ${box} place-items-center overflow-hidden rounded-md border border-stroke-subtle bg-card-hover transition-colors duration-100 ease-easy hover:border-stroke-strong`}
      >
        {photo.thumbnail && thumbnail.data !== undefined ? (
          <img
            data-testid="photo-thumb"
            src={thumbnail.data}
            alt={t('diary.photo.alt', { name: photo.fileName, day: formatDay(day) })}
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <span aria-hidden="true" className="text-fg-tertiary">
            <Open16Regular />
          </span>
        )}
      </button>
      {!photo.thumbnail && (
        <figcaption className="max-w-24 text-caption text-fg-tertiary">
          {t('diary.photo.noThumb')}
        </figcaption>
      )}
    </figure>
  );
}
