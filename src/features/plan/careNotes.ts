import type { CareTargetKind } from '@/domain/plan';

/** The key a target is found by on screen and in the e2e suite: `room:<id>`, `work:<workId>`. */
export function careTargetKey(targetKind: CareTargetKind, targetId: string): string {
  return `${targetKind}:${targetId}`;
}
