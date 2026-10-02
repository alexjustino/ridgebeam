import { documentsFigure, type DocumentRow } from '@/domain/documents';
import type { WorkSnapshot } from '@/domain/plan';
import { KIND_KEYS } from '@/features/documents/kinds';
import { useI18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/**
 * The documents the work holds (slice F7): counted, opening onto each one with its kind, grouped by
 * kind — "12 documents · 3 quotes · 2 permits" said as rows a person can read.
 */
export function DocumentsCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, number, day } = useI18n();
  const figure = documentsFigure(snapshot);

  return (
    <Card>
      <FigureRow<DocumentRow>
        testId="documents"
        size="title"
        figure={figure}
        label={t('documents.figure.all')}
        value={number(figure.value)}
        rowsLabel={t('documents.figure.rows')}
        groupBy={(row) => ({
          id: row.kind,
          label: t(KIND_KEYS[row.kind]),
          order: Object.keys(KIND_KEYS).indexOf(row.kind),
        })}
        renderRow={(row) => (
          <>
            <span className="font-semibold text-fg">{row.title}</span>
            {row.day !== null && (
              <>
                <span aria-hidden="true"> — </span>
                <span>{day(row.day)}</span>
              </>
            )}
          </>
        )}
      />
    </Card>
  );
}
