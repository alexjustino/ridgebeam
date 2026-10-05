import { useId, useMemo } from 'react';

import type { DiaryEntry } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import { photoStory, type StorySection } from '@/domain/reports/story';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';

import { PhotoThumb } from './PhotoThumb';
import { byMonth, storyMonth, storyPhotoWhat, storySectionTitle, storySpan } from './storyWords';

/**
 * The Diary's **In photos** (slice G6, decision 5): every photo the work holds — the diary's, the
 * hidden-work checks', the snags' — told room by room (or stage by stage when the work has no
 * rooms), each section from its first photo to its last. Nothing is sampled on screen: every photo
 * of a section is here, in order.
 *
 * Each section is `[data-story-section]` with `data-key` its key (`room:<id>`, `stage:<id>`,
 * `other` or `work`): its name, its span — "From … to … · 14 photos" — and its photos wrapping in
 * reading order, never in a strip that scrolls sideways, with a month's name above each month when
 * they span more than one. Each photo is `[data-story-photo]` with `data-day` and `data-kind`, and is
 * the diary's own thumbnail — a labelled button that opens the original in the system's viewer —
 * with its day and what it shows under it, in words (DESIGN_SYSTEM §8, _a story of photos runs
 * first to last_).
 *
 * The thumbnails load as the diary's do: one query a photo, keyed by its hash, so a photo the day
 * view already showed is not asked of the host again.
 */
export function StoryView({
  snapshot,
  entries,
}: {
  snapshot: WorkSnapshot;
  entries: readonly DiaryEntry[];
}) {
  const { t } = useI18n();
  const term = useTerms();
  const heading = useId();
  const story = useMemo(() => photoStory(snapshot, entries), [snapshot, entries]);
  // Whether the host could make a thumbnail, as the entry that carried the photo says; a photo of
  // a check or a snag is asked for one, as the Gates and Snags tabs ask.
  const thumbnails = useMemo(() => {
    const made = new Map<string, boolean>();
    for (const entry of entries) {
      for (const photo of entry.photos) made.set(photo.fileHash, photo.thumbnail);
    }
    return made;
  }, [entries]);
  const by =
    story.by === 'room'
      ? { key: 'byRoom' as const, vars: { room: term('room') } }
      : { key: 'byStage' as const, vars: { stage: term('stage') } };

  return (
    <section aria-labelledby={heading} data-testid="diary-story" className="flex flex-col gap-3">
      <h2 id={heading} className="text-subtitle font-semibold text-fg">
        {t('diary.story.title')}
      </h2>
      {story.sections.length === 0 ? (
        <Card>
          <EmptyState
            title={t('diary.story.empty.title')}
            description={t(`diary.story.empty.${by.key}`, by.vars)}
          />
        </Card>
      ) : (
        <>
          <p className="text-caption text-fg-tertiary">
            {t(`diary.story.lead.${by.key}`, by.vars)}
          </p>
          {story.sections.map((section) => (
            <StorySectionView key={section.key} section={section} thumbnails={thumbnails} />
          ))}
        </>
      )}
    </section>
  );
}

function StorySectionView({
  section,
  thumbnails,
}: {
  section: StorySection;
  thumbnails: ReadonlyMap<string, boolean>;
}) {
  const i18n = useI18n();
  const { t, dayShort } = i18n;
  const heading = useId();
  const title = storySectionTitle(i18n, section);
  const months = byMonth(section.photos);
  const labelled = months.length > 1;

  return (
    <section
      data-story-section=""
      data-key={section.key}
      aria-labelledby={heading}
      className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
    >
      <h3 id={heading} className="text-body-lg font-semibold text-fg">
        {title}
      </h3>
      <p className="mb-3 text-caption text-fg-secondary">{storySpan(i18n, section)}</p>
      <div className="flex flex-col gap-4">
        {months.map((month) => (
          <div key={month.month} className="flex flex-col gap-2">
            {labelled && (
              <h4
                id={`${heading}-${month.month}`}
                data-story-month={month.month}
                className="text-caption font-semibold text-fg-secondary"
              >
                {storyMonth(i18n, month.month)}
              </h4>
            )}
            <ol
              {...(labelled
                ? { 'aria-labelledby': `${heading}-${month.month}` }
                : { 'aria-label': t('diary.story.photos', { name: title }) })}
              className="flex flex-wrap gap-3"
            >
              {month.photos.map((photo) => (
                <li
                  key={photo.photoHash}
                  data-story-photo=""
                  data-day={photo.day}
                  data-kind={photo.kind}
                  className="flex w-28 flex-col gap-1"
                >
                  <PhotoThumb
                    day={photo.day}
                    photo={{
                      fileHash: photo.photoHash,
                      fileName: photo.fileName,
                      bytes: 0,
                      width: 0,
                      height: 0,
                      thumbnail: thumbnails.get(photo.photoHash) ?? true,
                    }}
                  />
                  <p className="text-caption break-words">
                    <span className="block text-fg-secondary">{dayShort(photo.day)}</span>
                    <span className="block text-fg">{storyPhotoWhat(i18n, photo)}</span>
                  </p>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
