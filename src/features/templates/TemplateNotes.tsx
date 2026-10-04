import { Dismiss20Regular } from '@fluentui/react-icons';

import type { TemplateNote } from '@/domain/templates/apply';
import { isTemplateLanguage } from '@/domain/templates/localise';
import { LANGUAGE_AUTONYMS } from '@/i18n/index';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';

import { dismissNotes, useAppliedNotes } from './notes';

/**
 * The notes a template left when it was applied to this work (`template-notes`), until dismissed.
 * Nothing when there are none. Dismissing removes the button that was pressed, so the focus goes to
 * where the caller says (`onDismissed`) — never lost to the top of the window.
 */
export function TemplateNotes({
  workId,
  onDismissed,
}: {
  workId: string;
  onDismissed: () => void;
}) {
  const { t, tp } = useI18n();
  const applied = useAppliedNotes(workId);
  if (applied === null) return null;

  return (
    <div data-testid="template-notes">
      <InfoBar severity="info" title={t('templates.notes.title', { title: applied.title })}>
        <ul className="flex list-disc flex-col gap-0.5 pl-4">
          {applied.notes.map((note, index) => (
            <li key={`${note.key}:${index}`}>{noteText(note, tp)}</li>
          ))}
        </ul>
        <div className="mt-2">
          <Button
            icon={<Dismiss20Regular />}
            data-testid="template-notes-dismiss"
            onClick={() => {
              dismissNotes();
              onDismissed();
            }}
          >
            {t('templates.notes.dismiss')}
          </Button>
        </div>
      </InfoBar>
    </div>
  );
}

/**
 * A note as a sentence: every note counts something, so it is a plural in the language's own rule;
 * a language is named in itself, never by its code.
 */
function noteText(note: TemplateNote, tp: I18n['tp']): string {
  const { count, language, ...rest } = note.params;
  const named =
    language === undefined
      ? {}
      : { language: isTemplateLanguage(language) ? LANGUAGE_AUTONYMS[language] : String(language) };
  return tp(note.key, Number(count ?? 0), { ...rest, ...named });
}
