import type { StoryPhoto, StorySection } from '@/domain/reports/story';
import { STORY_KIND_KEYS } from '@/domain/reports/story';
import type { MessageKey } from '@/i18n/en';
import { formatMonth } from '@/i18n/format';
import { capitalised } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of the work told in photos (slice G6), one set for the three places that tell it — the
 * Diary's **In photos**, the handover book and the owner's snapshot — so a photo is captioned the
 * same way on screen and on paper: its day, and what it shows in words (DESIGN_SYSTEM §8, _a story
 * of photos runs first to last_). Pure: an `I18n` and the domain's rows in, strings out.
 */

/** A section's title: the room's or the stage's name, or "Elsewhere in the work", "The whole work". */
export function storySectionTitle(
  i18n: Pick<I18n, 't'>,
  section: Pick<StorySection, 'name' | 'labelKey'>,
): string {
  if (section.name !== null) return section.name;
  return i18n.t((section.labelKey ?? 'story.section.other') as MessageKey);
}

/**
 * What a photo shows, in words: the activities its entry names (or "From the diary" when it names
 * none here), the check it answered, or the snag — "Snag #3 — the problem", "Snag #3 — fixed".
 */
export function storyPhotoWhat(i18n: Pick<I18n, 't'>, photo: StoryPhoto): string {
  switch (photo.kind) {
    case 'diary':
      return photo.activityNames.length > 0
        ? photo.activityNames.join(', ')
        : i18n.t(STORY_KIND_KEYS.diary as MessageKey);
    case 'hidden-work':
      return i18n.t(STORY_KIND_KEYS['hidden-work'] as MessageKey, {
        check: photo.checkName ?? '',
      });
    case 'snag-problem':
      return i18n.t(STORY_KIND_KEYS['snag-problem'] as MessageKey, {
        number: photo.snagNumber ?? '',
      });
    case 'snag-fix':
      return i18n.t(STORY_KIND_KEYS['snag-fix'] as MessageKey, {
        number: photo.snagNumber ?? '',
      });
  }
}

/** A photo's caption, as one line: "Sep 11, 2026 — Lay the tiles". */
export function storyCaption(i18n: Pick<I18n, 't' | 'dayShort'>, photo: StoryPhoto): string {
  return i18n.t('story.caption', {
    day: i18n.dayShort(photo.day),
    what: storyPhotoWhat(i18n, photo),
  });
}

/**
 * A section's span, as a line under its name: "From September 3, 2026 to June 18, 2027 · 14
 * photos" — or "On September 3, 2026 · 2 photos" when every photo is of one day.
 */
export function storySpan(
  i18n: Pick<I18n, 'tp' | 'day'>,
  span: { first: string; last: string; count: number },
): string {
  return span.first === span.last
    ? i18n.tp('story.span.on', span.count, { first: i18n.day(span.first) })
    : i18n.tp('story.span.from', span.count, {
        first: i18n.day(span.first),
        last: i18n.day(span.last),
      });
}

/**
 * A month, as a label: "September 2026", "Setembro de 2026" — from a `YYYY-MM-DD` day or a
 * `YYYY-MM` month.
 */
export function storyMonth(i18n: Pick<I18n, 'language'>, dayOrMonth: string): string {
  return capitalised(i18n.language, formatMonth(i18n.language, `${dayOrMonth.slice(0, 7)}-01`));
}

/** Photos in their order, cut where the month changes: one group a calendar month. */
export function byMonth<T extends { readonly day: string }>(
  photos: readonly T[],
): Array<{ month: string; photos: T[] }> {
  const groups: Array<{ month: string; photos: T[] }> = [];
  for (const photo of photos) {
    const month = photo.day.slice(0, 7);
    const last = groups.at(-1);
    if (last !== undefined && last.month === month) last.photos.push(photo);
    else groups.push({ month, photos: [photo] });
  }
  return groups;
}
