import {
  CheckmarkCircle16Regular,
  Clock16Regular,
  ErrorCircle16Regular,
  QuestionCircle16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';

import type { DecisionRow } from '@/domain/decisions';

import { useStatusText } from './statusText';

/** Soon enough to say so in the caution tone: the same horizon the decisions-due figure uses. */
const SOON = 5;

/**
 * A decision's status as a chip: a word from a closed list, an icon and a tone — never the tone
 * alone (DESIGN_SYSTEM §2). The deadline behind it is computed, never typed; the chip only says
 * where today stands against it.
 */
export function StatusChip({ row }: { row: Pick<DecisionRow, 'status' | 'daysLeft' | 'madeAt'> }) {
  const text = useStatusText()(row);
  const soon = row.status === 'due' && (row.daysLeft ?? 0) <= SOON;
  const look: { tone: string; icon: ReactNode } =
    row.status === 'made'
      ? {
          tone: 'bg-success-subtle text-fg',
          icon: <CheckmarkCircle16Regular className="text-success" />,
        }
      : row.status === 'overdue'
        ? {
            tone: 'bg-danger-subtle text-fg',
            icon: <ErrorCircle16Regular className="text-danger" />,
          }
        : row.status === 'unknown'
          ? { tone: 'bg-card-hover text-fg-secondary', icon: <QuestionCircle16Regular /> }
          : soon
            ? {
                tone: 'bg-caution-subtle text-fg',
                icon: <Warning16Regular className="text-caution" />,
              }
            : { tone: 'bg-info-subtle text-fg', icon: <Clock16Regular className="text-info" /> };

  return (
    <span
      data-testid="decision-status"
      data-status={row.status}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption ${look.tone}`}
    >
      <span aria-hidden="true" className="inline-grid">
        {look.icon}
      </span>
      {text}
    </span>
  );
}
