import type { ActivityProgress } from '@/domain/diary';
import type { GanttLayout } from '@/domain/schedule/gantt';

import type { GanttView } from './Gantt';

/** The words a bar is spoken with, from the window's language. */
export interface BarWords {
  spoken: (bar: {
    number: string;
    name: string;
    durationDays: number;
    start: string;
    finish: string;
    critical: boolean;
    progress: ActivityProgress | null;
    /** How often it was critical in the finish simulation, 0..1; `null` when not simulated. */
    criticality: number | null;
  }) => string;
  /** How often it was critical, in words for the label column — "8 in 10". */
  share?: (index: number) => string;
}

/**
 * The domain's layout, as the drawing reads it. Nothing is computed here but words: the geometry,
 * the critical flags and the ghosts are `ganttLayout`'s, so the chart and every other reading of
 * the schedule are the same numbers. `criticality` is the finish simulation's index per activity
 * (D1), or `null` when nothing in the plan has a range and there is nothing to shade.
 */
export function toGanttView(
  layout: GanttLayout,
  words: BarWords,
  progressById: ReadonlyMap<string, ActivityProgress> = new Map(),
  criticality: ReadonlyMap<string, number> | null = null,
): GanttView {
  const column = new Map(layout.columns.map((day, index) => [day.date, index]));
  /** The columns the diary says the work really took, when both ends fall on the chart. */
  const actual = (known: ActivityProgress | undefined) => {
    if (known === undefined || known.startedOn === null) return null;
    const from = column.get(known.startedOn);
    const to = column.get(known.finishedOn ?? known.lastOn ?? known.startedOn);
    return from === undefined || to === undefined || to < from
      ? null
      : { x: from, width: to - from + 1 };
  };
  const shareOf = (id: string) => {
    const index = criticality?.get(id);
    return index === undefined || words.share === undefined
      ? null
      : { index, words: words.share(index) };
  };
  return {
    columns: layout.columns,
    rows: layout.rows.map((row) =>
      row.kind === 'band'
        ? { kind: 'band', id: `stage:${row.stageId}`, label: `${row.number} ${row.name}` }
        : {
            kind: 'bar',
            id: row.activityId,
            label: `${row.number ?? ''} ${row.name}`.trim(),
            spoken: words.spoken({
              number: row.number ?? '',
              name: row.name,
              durationDays: row.durationDays,
              start: row.start,
              finish: row.finish,
              critical: row.critical,
              progress: progressById.get(row.activityId) ?? null,
              criticality: criticality?.get(row.activityId) ?? null,
            }),
            x: row.x,
            width: row.width,
            critical: row.critical,
            baseline: row.ghost === null ? null : { x: row.ghost.x, width: row.ghost.width },
            state: progressById.get(row.activityId)?.state ?? 'not-started',
            actual: actual(progressById.get(row.activityId)),
            criticality: shareOf(row.activityId),
          },
    ),
    arrows: layout.arrows.map((arrow) => ({
      from: arrow.fromId,
      to: arrow.toId,
      critical: arrow.critical,
    })),
  };
}
