import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { LIMITS } from '@/data/commands';
import { useCloseSnag } from '@/data/queries';
import type { Snag, SnagOutcome, WorkSnapshot } from '@/domain/plan';
import { validateSnagClosure, type SnagClosureDraft } from '@/domain/snags';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

import { SnagPhotoField } from './SnagPhotoField';
import { snagName, snagProblemsText } from './snagWords';
import { useAddSnagPhoto } from './useAddSnagPhoto';

/** What is being closed: the snag, and how. */
export interface SnagToClose {
  readonly snag: Snag;
  readonly outcome: SnagOutcome;
}

const KEYS = {
  fixed: {
    title: 'snags.fix.title',
    body: 'snags.fix.body',
    note: 'snags.fix.note',
    confirm: 'snags.fix.confirm',
  },
  withdrawn: {
    title: 'snags.withdraw.title',
    body: 'snags.withdraw.body',
    note: 'snags.withdraw.note',
    confirm: 'snags.withdraw.confirm',
  },
} as const;

/**
 * Closing a snag, once (slice E4, decision 5): **Fix…** asks for the photo of it fixed — required,
 * its field open from the start, so nobody learns of the rule from a refusal — and an optional note;
 * **Withdraw…** asks for the reason, required. The dialog names the snag and says what closing does:
 * the closure is kept for good, and a snag that comes back is a new one.
 *
 * Fixed without a photo, or withdrawn without a reason, is said inside the dialog in the domain's
 * sentence (`snag-close-problem`) and nothing is sent. The photo goes through the documents' intake
 * first, attached to the work; a file the host will not keep is named under the photo field
 * with its reason. The host's own refusal is said in the dialog (`snag-close-refused`), which stays
 * open with what was typed. Neither closing is drawn as danger: neither removes anything — the
 * wording carries what each does, and the confirming button repeats the verb.
 */
export function CloseSnagDialog({
  snapshot,
  closing,
  onClose,
  onClosed,
}: {
  snapshot: WorkSnapshot;
  closing: SnagToClose;
  onClose: () => void;
  onClosed: (closed: SnagToClose) => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const close = useCloseSnag();
  const photo = useAddSnagPhoto(snapshot);
  const field = useId();
  const [note, setNote] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [photoRefused, setPhotoRefused] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const { snag, outcome } = closing;
  const keys = KEYS[outcome];
  const fixing = outcome === 'fixed';
  const name = snagName(i18n, term, snag);
  const title = t(keys.title, { name });
  const busy = close.isPending || photo.adding;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    setPhotoRefused(null);
    const trimmed = note.trim();
    const draft: SnagClosureDraft = {
      snagId: snag.id,
      outcome,
      closedOn: today,
      photoHash: null,
      note: trimmed === '' ? null : trimmed,
    };
    // Said before anything is added or asked: the photo a fix needs, the reason a withdrawal needs.
    const before = validateSnagClosure(snapshot, draft).filter(
      (problem) => !(fixing && path !== null && problem.code === 'photo-required'),
    );
    const found = snagProblemsText(i18n, term, before);
    setProblems(found);
    if (found.length > 0) return;

    let photoHash: string | null = null;
    let checked = snapshot;
    if (fixing && path !== null) {
      const added = await photo.addPhoto(path);
      if (!added.ok) {
        setPhotoRefused(added.reason);
        return;
      }
      photoHash = added.hash;
      checked = added.snapshot;
    }
    const whole = { ...draft, photoHash };
    const late = snagProblemsText(i18n, term, validateSnagClosure(checked, whole));
    setProblems(late);
    if (late.length > 0) return;

    close.mutate(whole, {
      onSuccess: () => onClosed(closing),
      onError: (error) => setRefusal(describeError(error)),
    });
  };

  return (
    <Modal open label={title} onClose={busy ? () => undefined : onClose} width="lg">
      <form
        data-testid="snag-close"
        data-outcome={outcome}
        className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
        <p className="text-body text-fg-secondary">{t(keys.body, { snag: term('snag') })}</p>
        {fixing && (
          <SnagPhotoField
            legend={t('snags.fix.photo')}
            path={path}
            onPath={(next) => {
              setPath(next);
              setPhotoRefused(null);
            }}
            refused={photoRefused}
            pathTestId="snag-fix-photo-path"
            addTestId="snag-fix-photo-add"
          />
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
            {t(keys.note)}
          </label>
          <TextArea
            id={field}
            data-testid="snag-note"
            aria-required={fixing ? undefined : 'true'}
            maxLength={LIMITS.snagNote}
            aria-describedby={`${field}-hint`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <span id={`${field}-hint`} className="text-caption text-fg-tertiary">
            {t('snags.note.hint', { max: number(LIMITS.snagNote) })}
          </span>
        </div>
        {problems.length > 0 && (
          <div data-testid="snag-close-problem">
            <InfoBar severity="caution" title={t('snags.close.problem')}>
              <ul className="flex flex-col gap-0.5">
                {problems.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}
        {refusal !== null && (
          <div data-testid="snag-close-refused">
            <InfoBar severity="danger" title={t('snags.close.refused')}>
              {refusal}
            </InfoBar>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" appearance="accent" data-testid="snag-confirm" disabled={busy}>
            {busy ? t('common.working') : t(keys.confirm)}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
