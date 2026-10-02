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
  backupInspect,
  backupLast,
  backupRestore,
  backupWrite,
  diagnosticsSummary,
  activityAdd,
  activityMove,
  activitySetRooms,
  baselineTake,
  replanOpen,
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
  diaryExportCsv,
  diaryExportPdf,
  reportOpen,
  reportPdfWrite,
  workExportJson,
  photoOpen,
  photoThumbnail,
  dependencyRemove,
  dependencyUpdate,
  calendarSet,
  careNoteAdd,
  careNoteMove,
  careNoteRemove,
  careNoteUpdate,
  checkAdd,
  checkAnswer,
  checkMove,
  checkRemove,
  checkRename,
  checksAddDefaults,
  checkSetNeedsPhoto,
  personRemove,
  personUpdate,
  personSetStages,
  documentAdd,
  documentLink,
  documentOpen,
  documentRemove,
  documentThumbnail,
  documentUnlink,
  documentUpdate,
  documentsVerify,
  folderHealth,
  recentRelocate,
  commitmentAdd,
  commitmentRemove,
  commitmentUpdate,
  milestoneAdd,
  milestoneMove,
  milestoneRemove,
  milestoneUpdate,
  milestonesUsual,
  costLineAdd,
  costLineRemove,
  costLineUpdate,
  paymentAdd,
  paymentReverse,
  planApply,
  rangesTake,
  templateRead,
  templateWrite,
  roomAdd,
  roomMove,
  roomRemove,
  roomRename,
  stageClose,
  stageMove,
  stageReopen,
  stageStart,
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
  type Answer,
  type CommitmentDraft,
  type CommitmentPatch,
  type CostLinePatch,
  type BaselineRowDraft,
  type CalendarDraft,
  type CareNoteTarget,
  type DecisionPatch,
  type EntryDraft,
  type Gate,
  type MilestoneDraft,
  type MilestonePatch,
  type UsualMilestoneLabels,
  type PaymentDraftWire,
  type PersonPatch,
  type PlanToApply,
  type ReportDocument,
  type RestoreReport,
  type Provenance,
  type DocumentKind,
  type DocumentPatch,
  type DocumentTarget,
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
  documentThumb: (id: string) => ['document-thumb', id] as const,
  folderHealth: ['folder-health'] as const,
  backupLast: ['backup-last'] as const,
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
    client.invalidateQueries({ queryKey: keys.backupLast }),
  ]);
}

export function useCreateWork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      folder,
      draft,
      plan,
    }: {
      folder: string;
      draft: WorkDraft;
      plan?: PlanToApply;
    }) => workCreate(folder, draft, plan),
    onSuccess: () => reread(client),
    // A refused plan leaves no recent row behind; the list is read again so it shows exactly that.
    onError: () => client.invalidateQueries({ queryKey: keys.recent }),
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
      client.removeQueries({ queryKey: keys.backupLast });
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
  return useWorkCommand(({ id, name }: { id: string; name: string }) => personUpdate(id, { name }));
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
export type MoveKind = 'stage' | 'activity' | 'room' | 'decision' | 'check' | 'careNote';

const MOVES: Record<MoveKind, (id: string, direction: Direction) => Promise<WorkSnapshot>> = {
  stage: stageMove,
  activity: activityMove,
  room: roomMove,
  decision: decisionMove,
  check: checkMove,
  careNote: careNoteMove,
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

export function useReplanOpen() {
  return useWorkCommand((reason: string) => replanOpen(reason));
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

// ── Templates (F9) ───────────────────────────────────────────────────────────

/** Write a template's plan into the open, empty work. */
export function useApplyPlan() {
  return useWorkCommand(({ draft, provenance }: PlanToApply) => planApply(draft, provenance));
}

/** The lower or upper end of every range, as the duration of each activity that has none. */
export function useTakeRanges() {
  return useWorkCommand((which: 'low' | 'high') => rangesTake(which));
}

/** Read a template file's text. A question asked at a moment, of a file that may change: not cached. */
export function useReadTemplate() {
  return useMutation({ mutationFn: (path: string) => templateRead(path) });
}

export function useWriteTemplate() {
  return useMutation({
    mutationFn: ({ path, text, overwrite }: { path: string; text: string; overwrite: boolean }) =>
      templateWrite(path, text, overwrite),
  });
}

export type { Provenance };

// ── The diary (F4) ───────────────────────────────────────────────────────────

/** The whole diary, newest first. Closing or opening a work re-reads it. */
export function useDiary(enabled: boolean) {
  return useQuery({ queryKey: keys.diary, queryFn: () => diaryList(), enabled });
}

/**
 * Write one entry. The diary is read again. So is the work's snapshot when the entry carries a
 * photo: since F7 every photo copied in becomes a document of the work, and documents travel in
 * the snapshot — left alone, Documents and every report composed from it would miss the photo
 * until the next plan command (D4 found it: the owner's snapshot left the photo out).
 */
export function useAddEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: EntryDraft) => diaryEntryAdd(draft),
    onSuccess: (_, draft) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.diary }),
        ...(draft.photoPaths.length + draft.photoHashes.length > 0
          ? [client.invalidateQueries({ queryKey: keys.work })]
          : []),
      ]),
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

// ── Checks and gates (F5) ────────────────────────────────────────────────────

export function useAddCheck() {
  return useWorkCommand(({ stageId, gate, name }: { stageId: string; gate: Gate; name: string }) =>
    checkAdd(stageId, gate, name),
  );
}

export function useRenameCheck() {
  return useWorkCommand(({ id, name }: { id: string; name: string }) => checkRename(id, name));
}

export function useRemoveCheck() {
  return useWorkCommand((id: string) => checkRemove(id));
}

export function useAddDefaultChecks() {
  return useWorkCommand(
    ({
      stageId,
      start,
      close,
      needsPhoto,
    }: {
      stageId: string;
      start: string[];
      close: string[];
      needsPhoto: string[];
    }) => checksAddDefaults(stageId, start, close, needsPhoto),
  );
}

export function useAnswerCheck() {
  return useWorkCommand(
    ({
      checkId,
      answer,
      reason,
      photoPath,
      photoHash,
    }: {
      checkId: string;
      answer: Answer;
      reason: string | null;
      photoPath: string | null;
      photoHash: string | null;
    }) => checkAnswer(checkId, answer, reason, photoPath, photoHash),
  );
}

export function useSetNeedsPhoto() {
  return useWorkCommand(({ id, needsPhoto }: { id: string; needsPhoto: boolean }) =>
    checkSetNeedsPhoto(id, needsPhoto),
  );
}

export function useStartStage() {
  return useWorkCommand((id: string) => stageStart(id));
}

export function useCloseStage() {
  return useWorkCommand((id: string) => stageClose(id));
}

export function useReopenStage() {
  return useWorkCommand((id: string) => stageReopen(id));
}

// ── Care notes (D3) ──────────────────────────────────────────────────────────

export function useAddCareNote() {
  return useWorkCommand(({ target, text }: { target: CareNoteTarget; text: string }) =>
    careNoteAdd(target, text),
  );
}

export function useUpdateCareNote() {
  return useWorkCommand(({ id, text }: { id: string; text: string }) => careNoteUpdate(id, text));
}

export function useRemoveCareNote() {
  return useWorkCommand((id: string) => careNoteRemove(id));
}

// ── People and money (F6) ────────────────────────────────────────────────────

export function useUpdatePerson() {
  return useWorkCommand(({ id, patch }: { id: string; patch: PersonPatch }) =>
    personUpdate(id, patch),
  );
}

export function useAddCostLine() {
  return useWorkCommand(
    ({
      stageId,
      activityId,
      label,
      amountCents,
    }: {
      stageId: string;
      activityId: string | null;
      label: string;
      amountCents: number | null;
    }) => costLineAdd(stageId, activityId, label, amountCents),
  );
}

export function useUpdateCostLine() {
  return useWorkCommand(({ id, patch }: { id: string; patch: CostLinePatch }) =>
    costLineUpdate(id, patch),
  );
}

export function useRemoveCostLine() {
  return useWorkCommand((id: string) => costLineRemove(id));
}

export function useAddCommitment() {
  return useWorkCommand((draft: CommitmentDraft) => commitmentAdd(draft));
}

export function useUpdateCommitment() {
  return useWorkCommand(({ id, patch }: { id: string; patch: CommitmentPatch }) =>
    commitmentUpdate(id, patch),
  );
}

export function useRemoveCommitment() {
  return useWorkCommand((id: string) => commitmentRemove(id));
}

export function useAddPayment() {
  return useWorkCommand((draft: PaymentDraftWire) => paymentAdd(draft));
}

export function useReversePayment() {
  return useWorkCommand(({ seq, note }: { seq: number; note: string }) =>
    paymentReverse(seq, note),
  );
}

// ── A commitment's payment plan (D2) ─────────────────────────────────────────

export function useAddMilestone() {
  return useWorkCommand((draft: MilestoneDraft) => milestoneAdd(draft));
}

export function useUpdateMilestone() {
  return useWorkCommand(({ id, patch }: { id: string; patch: MilestonePatch }) =>
    milestoneUpdate(id, patch),
  );
}

export function useMoveMilestone() {
  return useWorkCommand(({ id, direction }: { id: string; direction: Direction }) =>
    milestoneMove(id, direction),
  );
}

export function useRemoveMilestone() {
  return useWorkCommand((id: string) => milestoneRemove(id));
}

export function useUsualMilestones() {
  return useWorkCommand(
    ({ commitmentId, labels }: { commitmentId: string; labels: UsualMilestoneLabels }) =>
      milestonesUsual(commitmentId, labels),
  );
}

// ── People, documents and the folder (F7) ────────────────────────────────────

export function useSetPersonStages() {
  return useWorkCommand(({ id, stageIds }: { id: string; stageIds: string[] }) =>
    personSetStages(id, stageIds),
  );
}

/**
 * Add files to the work. The snapshot that comes back is the new cache; the files the host would
 * not keep come back beside it, each with its reason, for the screen to name.
 */
export function useAddDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      paths,
      kind,
      target,
    }: {
      paths: string[];
      kind: DocumentKind;
      target: DocumentTarget | null;
    }) => documentAdd(paths, kind, target),
    onSuccess: async (result) => {
      client.setQueryData(keys.work, result.snapshot);
      await client.invalidateQueries({ queryKey: keys.folderHealth });
    },
  });
}

export function useUpdateDocument() {
  return useWorkCommand(({ id, patch }: { id: string; patch: DocumentPatch }) =>
    documentUpdate(id, patch),
  );
}

export function useLinkDocument() {
  return useWorkCommand(({ id, target }: { id: string; target: DocumentTarget }) =>
    documentLink(id, target),
  );
}

export function useUnlinkDocument() {
  return useWorkCommand(({ id, target }: { id: string; target: DocumentTarget }) =>
    documentUnlink(id, target),
  );
}

export function useRemoveDocument() {
  return useWorkCommand((id: string) => documentRemove(id));
}

export function useOpenDocument() {
  return useMutation({ mutationFn: documentOpen });
}

/** A document's thumbnail, read once: a document stored by its hash never changes. */
export function useDocumentThumbnail(id: string, image: boolean) {
  return useQuery({
    queryKey: keys.documentThumb(id),
    queryFn: () => documentThumbnail(id),
    enabled: image,
  });
}

/** Re-read every document's bytes, now: a question asked at a moment, so not cached. */
export function useVerifyDocuments() {
  return useMutation({ mutationFn: documentsVerify });
}

/** The folder, measured again every time the screen that shows it opens. */
export function useFolderHealth(enabled: boolean) {
  return useQuery({
    queryKey: keys.folderHealth,
    queryFn: folderHealth,
    enabled,
    refetchOnMount: 'always',
  });
}

/** Find a moved work again: relocate the recent row, then open the work from where it now is. */
export function useFindWork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ workId, folder }: { workId: string; folder: string }) => {
      await recentRelocate(workId, folder);
      return workOpen(folder);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.recent }),
    onSuccess: () => reread(client),
  });
}

// ── Reports and exports (F10) ────────────────────────────────────────────────
//
// Each writes one file and changes nothing in the work, so none touches the cache. A question asked
// at a moment of a file that may change: nothing here is cached either.

/** A composed document, written as a PDF: the weekly report or the schedule. */
export function useWriteReport() {
  return useMutation({
    mutationFn: ({
      path,
      document,
      overwrite,
    }: {
      path: string;
      document: ReportDocument;
      overwrite: boolean;
    }) => reportPdfWrite(path, document, overwrite, new Date().toISOString()),
  });
}

/** The diary as a PDF, its chain verified by the host at the moment of writing. */
export function useExportDiaryPdf() {
  return useMutation({
    mutationFn: ({
      path,
      document,
      overwrite,
    }: {
      path: string;
      document: ReportDocument;
      overwrite: boolean;
    }) => diaryExportPdf(path, document, overwrite, new Date().toISOString()),
  });
}

/** The diary as CSV, from the database itself, its chain verified first. */
export function useExportDiaryCsv() {
  return useMutation({
    mutationFn: ({
      path,
      separator,
      overwrite,
    }: {
      path: string;
      separator: ',' | ';';
      overwrite: boolean;
    }) => diaryExportCsv(path, separator, overwrite),
  });
}

/** The whole work as JSON. */
export function useExportWorkJson() {
  return useMutation({
    mutationFn: ({ path, overwrite }: { path: string; overwrite: boolean }) =>
      workExportJson(path, overwrite),
  });
}

/** Open a file a report command wrote in this session. */
export function useOpenReport() {
  return useMutation({ mutationFn: (path: string) => reportOpen(path) });
}

// ── Backup, restore and the diagnostics summary (F11) ────────────────────────

/** When the open work was last backed up on this machine — kept in the application database. */
export function useBackupLast(enabled: boolean) {
  return useQuery({
    queryKey: keys.backupLast,
    queryFn: backupLast,
    enabled,
    refetchOnMount: 'always',
  });
}

/** Write the open work as one `.ridgebeam` file. The last backup's day is read again after. */
export function useWriteBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, overwrite }: { path: string; overwrite: boolean }) =>
      backupWrite(path, overwrite),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.backupLast }),
  });
}

/** Read a backup's manifest without restoring it: a question asked of a file, so not cached. */
export function useInspectBackup() {
  return useMutation({ mutationFn: (path: string) => backupInspect(path) });
}

/**
 * Restore a backup into a new folder. The host opens the restored work, so everything a work opens
 * with is read again — and the act is not finished until it has been.
 *
 * `onRestored` hears the report before the work is read again: the screen that asked (Start) is
 * gone once the work is open, so what the restore found has to be handed on before then.
 */
export function useRestoreBackup(onRestored: (report: RestoreReport) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, folder }: { path: string; folder: string }) => backupRestore(path, folder),
    onSuccess: (report) => {
      onRestored(report);
      return reread(client);
    },
    onError: () => client.invalidateQueries({ queryKey: keys.recent }),
  });
}

/** Diagnostics as plain text, asked for at the moment it is copied. */
export function useDiagnosticsSummary() {
  return useMutation({ mutationFn: diagnosticsSummary });
}
