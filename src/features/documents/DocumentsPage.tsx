import {
  Add20Regular,
  Attach20Regular,
  Delete20Regular,
  Dismiss16Regular,
  DocumentPdf24Regular,
  FolderOpen20Regular,
  Open20Regular,
} from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useId, useMemo, useState, type FormEvent } from 'react';

import type { DocumentKind, RefusedFile } from '@/data/commands';
import {
  useAddDocuments,
  useDiary,
  useDocumentThumbnail,
  useLinkDocument,
  useOpenDocument,
  useRemoveDocument,
  useUnlinkDocument,
  useUpdateDocument,
} from '@/data/queries';
import type { DiaryEntry } from '@/domain/diary';
import {
  describeTarget,
  DOCUMENT_KINDS,
  documentsOf,
  linksOf,
  targetKey,
  type TargetKind,
} from '@/domain/documents';
import {
  activitiesInOrder,
  decisionsInOrder,
  stagesInOrder,
  type Document,
  type DocumentLink,
  type WorkSnapshot,
} from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Select } from '@/ui/Select';

import { NameField } from '../plan/NameField';

import { KIND_KEYS } from './kinds';

/** The kinds of row a document can be attached to from the picker (the work is the default). */
const ATTACHABLE: readonly Exclude<TargetKind, 'work'>[] = [
  'stage',
  'activity',
  'decision',
  'entry',
  'commitment',
  'payment',
];

/** How a link is said: its row's name, or "Entry #3", or that the row is gone. */
function useTargetName(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]) {
  const { t } = useI18n();
  return (link: DocumentLink): string => {
    const target = describeTarget(snapshot, link, entries);
    return t(target.labelKey as MessageKey, { name: target.name ?? '', seq: target.seq ?? '' });
  };
}

/**
 * The documents (slice F7, ADR-025): every file the work holds — copied into its folder by the
 * host, typed by its bytes, named by its hash, never parsed. Photos show their thumbnail; a PDF is a
 * mark, never a picture, and opens with the system's own reader on a press. This is the one place
 * documents are edited — titles, kinds, what they are attached to; elsewhere a row shows a count
 * that links here. A file the product does not keep is refused by name, and the others of the
 * batch are kept.
 */
export function DocumentsPage({
  snapshot,
  initialTarget,
}: {
  snapshot: WorkSnapshot;
  /** A row another page asked to filter on, `kind:id`. */
  initialTarget: string | null;
}) {
  const { t } = useI18n();
  const diary = useDiary(true);
  const entries = useMemo(() => diary.data ?? [], [diary.data]);
  const name = useTargetName(snapshot, entries);
  const [kind, setKind] = useState<DocumentKind | ''>('');
  const [target, setTarget] = useState(initialTarget ?? '');
  const [attaching, setAttaching] = useState<Document | null>(null);
  const [removing, setRemoving] = useState<Document | null>(null);
  const remove = useRemoveDocument();
  const [refusal, setRefusal] = useState<string | null>(null);

  // Every row something is attached to, once, for the filter.
  const targets = new Map<string, DocumentLink>();
  for (const document of snapshot.documents) {
    for (const link of linksOf(document)) targets.set(targetKey(link), link);
  }
  const chosenTarget = target === '' ? null : (targets.get(target) ?? null);
  const shown = (
    chosenTarget === null ? [...snapshot.documents] : documentsOf(snapshot, chosenTarget)
  )
    .filter((document) => kind === '' || document.kind === kind)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.documents')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('documents.lead')}</p>
      </header>

      <AddDocuments target={chosenTarget} />

      {refusal !== null && (
        <InfoBar severity="danger" title={t('documents.refused')}>
          {refusal}
        </InfoBar>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">
            {t('documents.filter.kind')}
          </span>
          <Select
            data-testid="documents-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as DocumentKind | '')}
          >
            <option value="">{t('documents.filter.allKinds')}</option>
            {DOCUMENT_KINDS.map((each) => (
              <option key={each} value={each}>
                {t(KIND_KEYS[each])}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">
            {t('documents.filter.target')}
          </span>
          <Select
            data-testid="documents-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{t('documents.filter.anything')}</option>
            {[...targets.entries()].map(([key, link]) => (
              <option key={key} value={key}>
                {name(link)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {snapshot.documents.length === 0 ? (
        <Card>
          <EmptyState
            title={t('documents.emptyTitle')}
            description={t('documents.emptyDescription')}
          />
        </Card>
      ) : shown.length === 0 ? (
        <p className="text-body text-fg-tertiary">{t('documents.filter.none')}</p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2">
          {shown.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              linkName={name}
              onAttach={() => setAttaching(document)}
              onRemove={() => setRemoving(document)}
              onRefused={setRefusal}
            />
          ))}
        </ol>
      )}

      <AttachDialog
        document={attaching}
        snapshot={snapshot}
        entries={entries}
        onClose={() => setAttaching(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title={removing === null ? '' : t('documents.confirm.title', { name: removing.title })}
        confirmLabel={t('documents.remove')}
        danger
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null) return;
          remove.mutate(removing.id, {
            onSuccess: () => {
              setRefusal(null);
              setRemoving(null);
            },
            onError: () => setRemoving(null),
          });
        }}
      >
        {t('documents.confirm.body')}
      </ConfirmDialog>
    </div>
  );
}

function AddDocuments({ target }: { target: DocumentLink | null }) {
  const { t, describeError } = useI18n();
  const add = useAddDocuments();
  const ids = useId();
  const [paths, setPaths] = useState<string[]>([]);
  const [field, setField] = useState('');
  const [kind, setKind] = useState<DocumentKind>('other');
  const [refused, setRefused] = useState<RefusedFile[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [dialogFailed, setDialogFailed] = useState(false);

  const push = (next: readonly string[]) =>
    setPaths((all) => [...all, ...next.filter((path) => !all.includes(path))]);

  const choose = async () => {
    try {
      const chosen = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: t('documents.add.title'),
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'pdf'],
          },
        ],
      });
      setDialogFailed(false);
      push(chosen === null ? [] : Array.isArray(chosen) ? chosen : [chosen]);
    } catch {
      setDialogFailed(true);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (paths.length === 0) return;
    add.mutate(
      { paths, kind, target },
      {
        onSuccess: (result) => {
          setFailure(null);
          setRefused(result.refused);
          setPaths([]);
        },
        onError: (error) => setFailure(describeError(error)),
      },
    );
  };

  return (
    <Card title={t('documents.add.title')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
          <Button icon={<FolderOpen20Regular />} onClick={() => void choose()}>
            {t('documents.choose')}
          </Button>
          <Input
            data-testid="document-path"
            aria-label={t('documents.path')}
            placeholder={t('documents.path')}
            aria-describedby={`${ids}-hint`}
            className="font-mono"
            spellCheck={false}
            value={field}
            onChange={(event) => setField(event.target.value)}
          />
          <Button
            icon={<Add20Regular />}
            data-testid="document-path-add"
            onClick={() => {
              if (field.trim() !== '') push([field.trim()]);
              setField('');
            }}
          >
            {t('diary.photos.add')}
          </Button>
        </div>
        <span id={`${ids}-hint`} className="text-caption text-fg-tertiary">
          {dialogFailed ? t('documents.dialogUnavailable') : t('documents.hint')}
        </span>
        {paths.length > 0 && (
          <ul className="flex flex-col gap-1">
            {paths.map((path) => (
              <li
                key={path}
                data-pending-document={path}
                className="flex items-center gap-2 text-caption text-fg"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
                <button
                  type="button"
                  aria-label={t('diary.photos.remove', { name: path })}
                  title={t('diary.photos.remove', { name: path })}
                  onClick={() => setPaths((all) => all.filter((each) => each !== path))}
                  className="grid size-6 place-items-center rounded-sm hover:bg-card-hover"
                >
                  <Dismiss16Regular aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[14rem_auto] items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('documents.kindOf')}
            </span>
            <Select
              data-testid="document-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as DocumentKind)}
            >
              {DOCUMENT_KINDS.map((each) => (
                <option key={each} value={each}>
                  {t(KIND_KEYS[each])}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <Button
              type="submit"
              appearance="accent"
              data-testid="documents-add"
              disabled={add.isPending || paths.length === 0}
            >
              {add.isPending ? t('common.working') : t('documents.add')}
            </Button>
          </div>
        </div>
        {(refused.length > 0 || failure !== null) && (
          <div data-testid="documents-problem">
            <InfoBar severity="caution" title={t('documents.problem')}>
              <ul className="flex flex-col gap-0.5">
                {refused.map((file, index) => (
                  <li key={index}>
                    {t('documents.refusedLine', { name: file.fileName, reason: file.reason })}
                  </li>
                ))}
                {failure !== null && <li>{failure}</li>}
              </ul>
            </InfoBar>
          </div>
        )}
      </form>
    </Card>
  );
}

function bytesText(
  bytes: number,
  t: ReturnType<typeof useI18n>['t'],
  number: (n: number) => string,
) {
  return bytes >= 1024 * 1024
    ? t('documents.size.mb', { value: number(Math.round((bytes / 1024 / 1024) * 10) / 10) })
    : t('documents.size.kb', { value: number(Math.max(1, Math.round(bytes / 1024))) });
}

function DocumentCard({
  document,
  linkName,
  onAttach,
  onRemove,
  onRefused,
}: {
  document: Document;
  linkName: (link: DocumentLink) => string;
  onAttach: () => void;
  onRemove: () => void;
  onRefused: (sentence: string | null) => void;
}) {
  const { t, day, number, describeError } = useI18n();
  const update = useUpdateDocument();
  const unlink = useUnlinkDocument();
  const openFile = useOpenDocument();
  const image = document.mediaType.startsWith('image/');
  const thumb = useDocumentThumbnail(document.id, image);
  const kept = () => onRefused(null);
  const refused = (error: unknown) => onRefused(describeError(error));

  return (
    <li data-document-id={document.id}>
      <Card>
        <div className="flex gap-3">
          <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md border border-stroke-subtle bg-card-hover">
            {image && typeof thumb.data === 'string' ? (
              <img
                data-testid="document-thumb"
                src={thumb.data}
                alt={document.title}
                className="size-full object-cover"
                draggable={false}
              />
            ) : !image ? (
              <span
                data-testid="document-mark"
                role="img"
                aria-label={t('documents.pdfMark')}
                title={t('documents.pdfMark')}
                className="flex flex-col items-center gap-0.5 text-fg-secondary"
              >
                <DocumentPdf24Regular aria-hidden="true" />
                <span aria-hidden="true" className="text-caption font-semibold">
                  {t('documents.pdf')}
                </span>
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <NameField
              key={document.title}
              testId="document-title"
              value={document.title}
              label={t('documents.titleOf', { name: document.fileName })}
              onCommit={(title) =>
                update.mutate(
                  { id: document.id, patch: { title } },
                  { onSuccess: kept, onError: refused },
                )
              }
            />
            <Select
              data-testid="document-kind-select"
              aria-label={t('documents.kindSelect', { name: document.title })}
              value={document.kind}
              onChange={(event) =>
                update.mutate(
                  { id: document.id, patch: { kind: event.target.value as DocumentKind } },
                  { onSuccess: kept, onError: refused },
                )
              }
            >
              {DOCUMENT_KINDS.map((each) => (
                <option key={each} value={each}>
                  {t(KIND_KEYS[each])}
                </option>
              ))}
            </Select>
            <p className="text-caption text-fg-tertiary">
              {t('documents.meta', {
                size: bytesText(document.bytes, t, number),
                day: day(document.addedOn),
                author: document.authorName,
              })}
            </p>
          </div>
        </div>
        {linksOf(document).length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-tertiary">
              {t('documents.links')}
            </span>
            <ul className="flex flex-wrap gap-1.5">
              {linksOf(document).map((link) => (
                <li
                  key={targetKey(link)}
                  data-link-target={targetKey(link)}
                  className="flex items-center gap-1 rounded-md border border-stroke-subtle bg-layer py-0.5 pr-0.5 pl-2 text-caption text-fg"
                >
                  <span>{linkName(link)}</span>
                  {link.targetKind !== 'work' && (
                    <button
                      type="button"
                      data-testid="document-unlink"
                      aria-label={t('documents.unlink', { name: linkName(link) })}
                      title={t('documents.unlink', { name: linkName(link) })}
                      disabled={unlink.isPending}
                      onClick={() =>
                        unlink.mutate(
                          { id: document.id, target: link },
                          { onSuccess: kept, onError: refused },
                        )
                      }
                      className="grid size-6 place-items-center rounded-sm text-fg-secondary hover:bg-card-hover"
                    >
                      <Dismiss16Regular aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button
            icon={<Open20Regular />}
            data-testid="document-open"
            aria-label={t('documents.openNamed', { name: document.title })}
            onClick={() => openFile.mutate(document.id)}
          >
            {t('documents.open')}
          </Button>
          <Button icon={<Attach20Regular />} data-testid="document-attach" onClick={onAttach}>
            {t('documents.attach')}
          </Button>
          <Button
            appearance="subtle"
            icon={<Delete20Regular />}
            data-testid="document-remove"
            aria-label={t('documents.removeNamed', { name: document.title })}
            onClick={onRemove}
          >
            {t('documents.remove')}
          </Button>
        </div>
      </Card>
    </li>
  );
}

function AttachDialog({
  document,
  snapshot,
  entries,
  onClose,
}: {
  document: Document | null;
  snapshot: WorkSnapshot;
  entries: readonly DiaryEntry[];
  onClose: () => void;
}) {
  const { t, day, money, describeError } = useI18n();
  const term = useTerms();
  const link = useLinkDocument();
  const ids = useId();
  const [kind, setKind] = useState<Exclude<TargetKind, 'work'> | ''>('');
  const [target, setTarget] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setKind('');
    setTarget('');
    setProblem(null);
    onClose();
  };

  const options: Array<{ value: string; label: string }> =
    kind === 'stage'
      ? stagesInOrder(snapshot).map((each) => ({ value: each.id, label: each.name }))
      : kind === 'activity'
        ? activitiesInOrder(snapshot).map((each) => ({ value: each.id, label: each.name }))
        : kind === 'decision'
          ? decisionsInOrder(snapshot).map((each) => ({ value: each.id, label: each.name }))
          : kind === 'entry'
            ? [...entries]
                .sort((a, b) => b.seq - a.seq)
                .map((each) => ({
                  value: String(each.seq),
                  label: `${t('documents.target.entry', { seq: each.seq })} · ${day(each.day)}`,
                }))
            : kind === 'commitment'
              ? snapshot.commitments.map((each) => ({ value: each.id, label: each.label }))
              : kind === 'payment'
                ? [...snapshot.payments]
                    .sort((a, b) => b.seq - a.seq)
                    .map((each) => ({
                      value: String(each.seq),
                      label: `${t('documents.target.payment', { seq: each.seq })} · ${money(each.amountCents, snapshot.work.currency)}`,
                    }))
                : [];

  return (
    <Modal
      open={document !== null}
      label={document === null ? '' : t('documents.attach.title', { name: document.title })}
      onClose={close}
    >
      {document !== null && (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (kind === '' || target === '') {
              setProblem(t('documents.attach.problem'));
              return;
            }
            link.mutate(
              { id: document.id, target: { targetKind: kind, targetId: target } },
              {
                onSuccess: close,
                onError: (error) => setProblem(describeError(error)),
              },
            );
          }}
        >
          <h2 className="text-body-lg font-semibold text-fg">
            {t('documents.attach.title', { name: document.title })}
          </h2>
          <label htmlFor={`${ids}-kind`} className="text-caption font-semibold text-fg-secondary">
            {t('documents.attach.kind')}
          </label>
          <Select
            id={`${ids}-kind`}
            data-testid="attach-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as Exclude<TargetKind, 'work'> | '');
              setTarget('');
            }}
          >
            <option value="">{t('documents.attach.choose')}</option>
            {ATTACHABLE.map((each) => (
              <option key={each} value={each}>
                {term(each, { capital: true })}
              </option>
            ))}
          </Select>
          <label htmlFor={`${ids}-target`} className="text-caption font-semibold text-fg-secondary">
            {t('documents.attach.target')}
          </label>
          <Select
            id={`${ids}-target`}
            data-testid="attach-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{t('documents.attach.choose')}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {problem !== null && (
            <InfoBar severity="caution" title={t('documents.refused')}>
              {problem}
            </InfoBar>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={link.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="attach-confirm"
              disabled={link.isPending}
            >
              {link.isPending ? t('common.working') : t('documents.attach.confirm')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
