import { Attach16Regular } from '@fluentui/react-icons';

import { useNavigation } from '@/app/navigation';
import { documentCounts, targetKey } from '@/domain/documents';
import type { DocumentLink, WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';

/**
 * How many documents a row has, as a paperclip and a number that opens the Documents page filtered
 * to that row. Documents are edited in one place; everywhere else they are a count that links.
 */
export function DocumentsCount({
  snapshot,
  target,
  name,
  testId,
}: {
  snapshot: WorkSnapshot;
  target: DocumentLink;
  /** The row's own name, for the button's accessible name. */
  name: string;
  testId: string;
}) {
  const { t, number } = useI18n();
  const { openDocuments } = useNavigation();
  const count = documentCounts(snapshot).get(targetKey(target)) ?? 0;

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={t('documents.countOf', { name, count: number(count) })}
      title={t('documents.countOf', { name, count: number(count) })}
      onClick={() => openDocuments(target)}
      className="inline-flex h-(--density-control) shrink-0 items-center gap-1 rounded-md px-2 text-caption text-fg-secondary tabular-nums transition-colors duration-100 ease-easy hover:bg-card-hover"
    >
      <span aria-hidden="true" className="inline-grid">
        <Attach16Regular />
      </span>
      {number(count)}
    </button>
  );
}
