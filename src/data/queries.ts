/**
 * TanStack Query bindings for the host commands: the cache keys, and one hook per question or act.
 *
 * Four keys, and what each holds:
 *
 * - `['system']` — what the running binary says about itself. Read once: it does not change.
 * - `['settings']` — the person's choices. This window is their only writer, so a write sets
 *   the answer straight into the cache rather than asking again.
 * - `['recent']` — the works this machine has opened. Invalidated by create, open and close.
 * - `['work']` — the open work's whole snapshot, or `null` when none is open. Every plan command
 *   answers with the whole snapshot, and the answer is set into this key as it arrives: the
 *   screen shows what the host holds, never a guess about what changed.
 *
 * Diagnostics sits under `['diagnostics']` and is re-read whenever its screen opens, because the
 * files it describes change under it — a work opened, a work closed. The Windows accent ramp sits
 * under `['accent']`, read once per window. The diary is `['diary']` — not in the snapshot — and
 * every entry written invalidates it; a thumbnail is `['photo', hash]`, read once, because a photo
 * stored by its hash never changes.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { Direction } from '@/domain/ordering';
import type { Endpoint, Holiday } from '@/domain/plan';

import {
  accentRamp,
  activityAdd,
  activityMove,
  activitySetRooms,
  baselineTake,
  decisionAdd,
  decisionMake,
  decisionMove,
  decisionRemove,
  decisionReopen,
  decisionUpdate,
  dependencyAdd,
  diaryEntryAdd,
  diaryList,
  diaryVerify,
  photoOpen,
  photoThumbnail,
  dependencyRemove,
  dependencyUpdate,
  calendarSet,
  personRemove,
  personRename,
  roomAdd,
  roomMove,
  roomRemove,
  roomRename,
  stageMove,
  activityRemove,
  activityUpdate,
  diagnostics,
  personAdd,
  recentWorks,
  settingsGet,
  settingsSet,
  stageAdd,
  stageRemove,
  stageRename,
  systemInfo,
  workClose,
  workCreate,
  workCurrent,
  workGet,
  workOpen,
  workUpdate,
  type ActivityPatch,
  type BaselineRowDraft,
  type CalendarDraft,
  type DecisionPatch,
  type EntryDraft,
  type SettingKey,
  type Settings,
  type WorkDraft,
  type WorkPatch,
  type WorkSnapshot,
} from './commands';
import { errorKind } from './errors';

export const keys = {
  system: ['system'] as const,
  settings: ['settings'] as const,
  recent: ['recent'] as const,
  work: ['work'] as const,
  diagnostics: ['diagnostics'] as const,
  diary: ['diary'] as const,
  photo: (hash: string) => ['photo', hash] as const,
};

// ── The application ──────────────────────────────────────────────────────────

export function useSystemInfo() {
  return useQuery({ queryKey: keys.system, queryFn: systemInfo });
}

/** The ramp Windows gave for the person's accent colour. */
export function useAccentRamp() {
  return useQuery({ queryKey: ['accent'] as const, queryFn: accentRamp });
}

/** Re-read every time the screen that shows it opens. */
export function useDiagnostics() {
  return useQuery({ queryKey: keys.diagnostics, queryFn: diagnostics, refetchOnMount: 'always' });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: settingsGet });
}

/**
 * Keep one choice.
 *
 * The choice shows at once — the cache is updated before the host answers, so the theme or the
 * language changes on the press — and the host's answer then replaces it. A refusal puts the
 * previous choice back, and the screen says why in the host's sentence.
 */
export function useSetSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: string }) => settingsSet(key, value),
    onMutate: async ({ key, value }) => {
      await client.cancelQueries({ queryKey: keys.settings });
      const previous = client.getQueryData<Settings>(keys.settings);
      if (previous !== undefined) {
        client.setQueryData<Settings>(keys.settings, { ...previous, [key]: value });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(keys.settings, context.previous);
      }
    },
    onSuccess: (settings) => {
      client.setQueryData(keys.settings, settings);
    },
  });
}

export function useRecentWorks() {
  return useQuery({ queryKey: keys.recent, queryFn: recentWorks });
}

// ── The work ─────────────────────────────────────────────────────────────────

/** The open work's snapshot, or `null` when no work is open. */
async function openWork(): Promise<WorkSnapshot | null> {
  const current = await workCurrent();
  return current === null ? null : workGet();
}

export function useWork() {
  return useQuery({ queryKey: keys.work, queryFn: openWork });
}

/**
 * After a work is created or opened, the snapshot, the recent list and Diagnostics are read
 * again — and the act is not finished until they have been, so the screen that follows never
 * draws the work that was there before.
 */
async function reread(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: keys.work }),
    client.invalidateQueries({ queryKey: keys.recent }),
    client.invalidateQueries({ queryKey: keys.diagnostics }),
    client.invalidateQueries({ queryKey: keys.diary }),
  ]);
}

export function useCreateWork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ folder, draft }: { folder: string; draft: WorkDraft }) =>
      workCreate(folder, draft),
    onSuccess: () => reread(client),
  });
}

export function useOpenWork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (folder: string) => workOpen(folder),
    onSuccess: () => reread(client),
  });
}

export function useCloseWork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: workClose,
    onSuccess: async () => {
      client.setQueryData(keys.work, null);
      client.removeQueries({ queryKey: keys.diary });
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.recent }),
        client.invalidateQueries({ queryKey: keys.diagnostics }),
      ]);
    },
  });
}

/**
 * A command that answers with the whole plan: the answer is the new cache. A work whose folder
 * went away while it was open is read again, so the shell sees the refusal and says so.
 */
function useWorkCommand<Variables>(command: (variables: Variables) => Promise<WorkSnapshot>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: command,
    onSuccess: (snapshot) => {
      client.setQueryData(keys.work, snapshot);
    },
    onError: (error) => {
      if (errorKind(error) === 'work_moved') {
        void client.invalidateQueries({ queryKey: keys.work });
      }
    },
  });
}

export function useUpdateWork() {
  return useWorkCommand((patch: WorkPatch) => workUpdate(patch));
}

export function useAddPerson() {
  return useWorkCommand((name: string) => personAdd(name));
}

export function useAddStage() {
  return useWorkCommand((name: string) => stageAdd(name));
}

export function useRenameStage() {
  return useWorkCommand(({ id, name }: { id: string; name: string }) => stageRename(id, name));
}

export function useRemoveStage() {
  return useWorkCommand((id: string) => stageRemove(id));
}

export function useAddActivity() {
  return useWorkCommand(({ stageId, name }: { stageId: string; name: string }) =>
    activityAdd(stageId, name),
  );
}

export function useUpdateActivity() {
  return useWorkCommand(({ id, patch }: { id: string; patch: ActivityPatch }) =>
    activityUpdate(id, patch),
  );
}

export function useRemoveActivity() {
  return useWorkCommand((id: string) => activityRemove(id));
}

export function useSetCalendar() {
  return useWorkCommand(
    ({ calendar, holidays }: { calendar: CalendarDraft; holidays: readonly Holiday[] }) =>
      calendarSet(calendar, holidays),
  );
}

export function useRenamePerson() {
  return useWorkCommand(({ id, name }: { id: string; name: string }) => personRename(id, name));
}

export function useRemovePerson() {
  return useWorkCommand((id: string) => personRemove(id));
}

export function useAddRoom() {
  return useWorkCommand((name: string) => roomAdd(name));
}

export function useRenameRoom() {
  return useWorkCommand(({ id, name }: { id: string; name: string }) => roomRename(id, name));
}

export function useRemoveRoom() {
  return useWorkCommand((id: string) => roomRemove(id));
}

/** A move names what moves: a stage, an activity inside its stage, or a room. */
export type MoveKind = 'stage' | 'activity' | 'room' | 'decision';

const MOVES: Record<MoveKind, (id: string, direction: Direction) => Promise<WorkSnapshot>> = {
  stage: stageMove,
  activity: activityMove,
  room: roomMove,
  decision: decisionMove,
};

export function useMove() {
  return useWorkCommand(
    ({ kind, id, direction }: { kind: MoveKind; id: string; direction: Direction }) =>
      MOVES[kind](id, direction),
  );
}

export function useSetActivityRooms() {
  return useWorkCommand(({ id, roomIds }: { id: string; roomIds: readonly string[] }) =>
    activitySetRooms(id, roomIds),
  );
}

export function useAddDependency() {
  return useWorkCommand(
    ({ blocker, blocked, lagDays }: { blocker: Endpoint; blocked: Endpoint; lagDays: number }) =>
      dependencyAdd(blocker, blocked, lagDays),
  );
}

export function useUpdateDependency() {
  return useWorkCommand(({ id, lagDays }: { id: string; lagDays: number }) =>
    dependencyUpdate(id, lagDays),
  );
}

export function useRemoveDependency() {
  return useWorkCommand((id: string) => dependencyRemove(id));
}

export function useTakeBaseline() {
  return useWorkCommand(
    ({ rows, finishDate }: { rows: readonly BaselineRowDraft[]; finishDate: string | null }) =>
      baselineTake(rows, finishDate),
  );
}

export function useAddDecision() {
  return useWorkCommand(
    ({ stageId, name, leadTimeDays }: { stageId: string; name: string; leadTimeDays: number }) =>
      decisionAdd(stageId, name, leadTimeDays),
  );
}

export function useUpdateDecision() {
  return useWorkCommand(({ id, patch }: { id: string; patch: DecisionPatch }) =>
    decisionUpdate(id, patch),
  );
}

export function useRemoveDecision() {
  return useWorkCommand((id: string) => decisionRemove(id));
}

export function useMakeDecision() {
  return useWorkCommand(({ id, answer }: { id: string; answer: string | null }) =>
    decisionMake(id, answer),
  );
}

export function useReopenDecision() {
  return useWorkCommand((id: string) => decisionReopen(id));
}

// ── The diary (F4) ───────────────────────────────────────────────────────────

/** The whole diary, newest first. Closing or opening a work re-reads it. */
export function useDiary(enabled: boolean) {
  return useQuery({ queryKey: keys.diary, queryFn: () => diaryList(), enabled });
}

/** Write one entry. The diary is read again; the plan is not touched, because it has not changed. */
export function useAddEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: EntryDraft) => diaryEntryAdd(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.diary }),
  });
}

/** Recompute every hash and link, now: a question asked at a moment, so not cached. */
export function useVerifyDiary() {
  return useMutation({ mutationFn: diaryVerify });
}

export function usePhotoThumbnail(hash: string, available: boolean) {
  return useQuery({
    queryKey: keys.photo(hash),
    queryFn: () => photoThumbnail(hash),
    enabled: available,
  });
}

export function useOpenPhoto() {
  return useMutation({ mutationFn: photoOpen });
}
