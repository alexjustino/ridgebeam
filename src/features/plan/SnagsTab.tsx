import {
  ArrowUndo20Regular,
  Camera20Regular,
  DocumentAdd20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useToday } from '@/app/today';
import type { Snag, WorkSnapshot } from '@/domain/plan';
import { snagRows, type SnagRow } from '@/domain/snags';
import { PhotoThumb } from '@/features/diary/PhotoThumb';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';

import { CloseSnagDialog, type SnagToClose } from './CloseSnagDialog';
import { RaiseSnagForm } from './RaiseSnagForm';
import {
  photoFileName,
  snagClosureText,
  snagDueText,
  snagNameCapital,
  snagNoteText,
  snagRowTitle,
  snagStateText,
  snagWaitedText,
  snagWhereText,
  snagWhoText,
} from './snagWords';

/**
 * The Plan's **Snags** tab (slice E4, decision 5; pt "Pendências"): what was found wrong or
 * unfinished near the end, and what became of it. **Raise a snag…** above; then the snags still to
 * fix — open first, each by number, one past its day marked in words and with an icon, never colour
 * alone — each with **Fix…** and **Withdraw…**; then those fixed or withdrawn, with how and when, and
 * the photos of the problem and of the fix side by side.
 *
 * The order and every day count are the domain's `snagRows`. A snag is never edited and never
 * deleted: a mistake is withdrawn with a reason, and the record keeps both. A plan with no stage
 * takes no snag, and the disabled button says why beside it (§10).
 *
 * After raising, the new snag's row takes the focus; after closing, the closed one does — never left
 * on a button that is gone.
 */
export function SnagsTab({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t } = i18n;
  const term = useTerms();
  const today = useToday();
  const reason = useId();
  const [raising, setRaising] = useState(false);
  const [closing, setClosing] = useState<SnagToClose | null>(null);
  const focusNext = useRef<string | null>(null);
  const raiseButton = useRef<HTMLButtonElement>(null);
  const rowsRef = useRef(new Map<string, HTMLLIElement>());

  const rows = useMemo(() => snagRows(snapshot, today), [snapshot, today]);
  const byId = new Map(snapshot.snags.map((snag) => [snag.id, snag]));
  const open = rows.filter((row) => row.state === 'open');
  const closed = rows.filter((row) => row.state !== 'open');
  const hasStage = snapshot.stages.length > 0;

  // Each row on screen, by its snag, for the focus to be put back on after raising or closing.
  const register = useCallback((snagId: string, element: HTMLLIElement | null) => {
    if (element === null) rowsRef.current.delete(snagId);
    else rowsRef.current.set(snagId, element);
  }, []);

  useEffect(() => {
    if (focusNext.current === null) return;
    rowsRef.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [snapshot]);

  const closed_ = (done: SnagToClose) => {
    const name = snagNameCapital(i18n, term, done.snag);
    setClosing(null);
    announce(t(done.outcome === 'fixed' ? 'snags.fixed' : 'snags.withdrawn', { name }));
    focusNext.current = done.snag.id;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-body text-fg-secondary">
        {t('snags.lead', { snag: term('snag') })}
      </p>

      {raising ? (
        <RaiseSnagForm
          snapshot={snapshot}
          onDone={(snagId) => {
            setRaising(false);
            focusNext.current = snagId;
          }}
          onCancel={() => {
            setRaising(false);
            requestAnimationFrame(() => raiseButton.current?.focus());
          }}
        />
      ) : (
        <div className="flex flex-col items-start gap-1">
          <Button
            ref={raiseButton}
            appearance="accent"
            icon={<DocumentAdd20Regular />}
            data-testid="snag-raise"
            disabled={!hasStage}
            aria-describedby={hasStage ? undefined : reason}
            onClick={() => setRaising(true)}
          >
            {t('snags.raise')}
          </Button>
          {!hasStage && (
            <p id={reason} data-testid="snag-raise-locked" className="text-body text-fg-secondary">
              {t('snags.raise.noStage', { snag: term('snag'), stage: term('stage') })}
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p data-testid="snags-none" className="text-body text-fg-tertiary">
          {t('snags.none')}
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-body-lg font-semibold text-fg">{t('snags.list.open')}</h3>
          {open.length === 0 ? (
            <p data-testid="snags-open-none" className="text-body text-fg-secondary">
              {t('snags.list.openNone')}
            </p>
          ) : (
            <ul aria-label={t('snags.list.open')} className="flex flex-col gap-3">
              {open.map((row) => (
                <SnagLine
                  key={row.snagId}
                  ref={(element) => register(row.snagId, element)}
                  snapshot={snapshot}
                  row={row}
                  snag={byId.get(row.snagId)}
                  onClose={(snag, outcome) => setClosing({ snag, outcome })}
                />
              ))}
            </ul>
          )}
        </section>
      )}
      {closed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-body-lg font-semibold text-fg">{t('snags.list.closed')}</h3>
          <ul aria-label={t('snags.list.closed')} className="flex flex-col gap-3">
            {closed.map((row) => (
              <SnagLine
                key={row.snagId}
                ref={(element) => register(row.snagId, element)}
                snapshot={snapshot}
                row={row}
                snag={byId.get(row.snagId)}
                onClose={(snag, outcome) => setClosing({ snag, outcome })}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Mounted only while open, so each opening starts empty — and its photo field takes drops. */}
      {closing !== null && (
        <CloseSnagDialog
          snapshot={snapshot}
          closing={closing}
          onClose={() => setClosing(null)}
          onClosed={closed_}
        />
      )}
    </div>
  );
}

/**
 * One snag: its number and title, where it stands, where it is and who must fix it, its day or how
 * it was closed, its description and note, its photos — and, while open, the two ways to close it.
 */
function SnagLine({
  ref,
  snapshot,
  row,
  snag,
  onClose,
}: {
  ref: (element: HTMLLIElement | null) => void;
  snapshot: WorkSnapshot;
  row: SnagRow;
  snag: Snag | undefined;
  onClose: (snag: Snag, outcome: 'fixed' | 'withdrawn') => void;
}) {
  const i18n = useI18n();
  const { t, day } = i18n;
  const term = useTerms();
  const heading = useId();
  const title = snagRowTitle(i18n, row);
  const due = snagDueText(i18n, row);
  const waited = snagWaitedText(i18n, row);
  const closure = snagClosureText(i18n, row, snag);
  const note = snagNoteText(i18n, row);
  const isOpen = row.state === 'open';

  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-snag-id={row.snagId}
      data-state={row.state}
      data-overdue={row.overdue ? 'true' : 'false'}
      aria-labelledby={heading}
    >
      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h4 id={heading} className="text-body-lg font-semibold text-fg">
              {title}
            </h4>
            <span
              data-testid="snag-state"
              className={[
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption text-fg',
                isOpen
                  ? row.overdue
                    ? 'bg-caution-subtle'
                    : 'bg-info-subtle'
                  : row.state === 'fixed'
                    ? 'bg-success-subtle'
                    : 'bg-card-hover',
              ].join(' ')}
            >
              {row.overdue && <Warning16Regular aria-hidden="true" className="text-caution" />}
              {snagStateText(i18n, row)}
              {waited !== null && ` · ${waited}`}
            </span>
          </div>
          <p className="text-body text-fg-secondary">
            {[snagWhereText(i18n, term, row), snagWhoText(i18n, row)].join(' · ')}
          </p>
          <p className="text-body text-fg-secondary">
            {t('snags.row.raised', { day: day(row.raisedOn), author: snag?.authorName ?? '' })}
          </p>
          {due !== null && (
            <p
              data-testid="snag-due-text"
              className={row.overdue ? 'text-body font-semibold text-fg' : 'text-body text-fg'}
            >
              {due}
            </p>
          )}
          {row.description !== null && row.description.trim() !== '' && (
            <p className="text-body whitespace-pre-line text-fg">{row.description}</p>
          )}
          {closure !== null && (
            <p data-testid="snag-closure" className="text-body text-fg">
              {closure}
            </p>
          )}
          {note !== null && <p className="text-body text-fg-secondary">{note}</p>}
          <SnagPhotos snapshot={snapshot} row={row} name={title} />
          {isOpen && snag !== undefined && (
            <div
              role="group"
              aria-label={t('snags.row.actions', { name: title })}
              className="grid grid-cols-2 gap-2 lg:flex"
            >
              <Button
                icon={<Camera20Regular />}
                data-testid="snag-fix"
                onClick={() => onClose(snag, 'fixed')}
              >
                {t('snags.fix')}
              </Button>
              <Button
                icon={<ArrowUndo20Regular />}
                data-testid="snag-withdraw"
                onClick={() => onClose(snag, 'withdrawn')}
              >
                {t('snags.withdraw')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}

/** The photo of the problem and the photo of the fix, side by side, each captioned. */
function SnagPhotos({
  snapshot,
  row,
  name,
}: {
  snapshot: WorkSnapshot;
  row: SnagRow;
  name: string;
}) {
  const { t } = useI18n();
  const photo = (hash: string, day: string, caption: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-fg-secondary">{caption}</span>
      <PhotoThumb
        size="sm"
        day={day}
        photo={{
          fileHash: hash,
          fileName: photoFileName(snapshot, hash, row.title),
          bytes: 0,
          width: 0,
          height: 0,
          thumbnail: true,
        }}
      />
    </div>
  );
  if (row.photoHash === null && row.fixPhotoHash === null) {
    return <p className="text-caption text-fg-tertiary">{t('snags.row.noPhoto')}</p>;
  }
  return (
    <div
      role="group"
      aria-label={t('snags.row.photos', { name })}
      data-testid="snag-photos"
      className="flex flex-wrap gap-4"
    >
      {row.photoHash !== null
        ? photo(row.photoHash, row.raisedOn, t('snags.row.photoBefore'))
        : null}
      {row.fixPhotoHash !== null && row.closedOn !== null
        ? photo(row.fixPhotoHash, row.closedOn, t('snags.row.photoAfter'))
        : null}
    </div>
  );
}
