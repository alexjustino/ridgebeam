import { save } from '@tauri-apps/plugin-dialog';
import { useCallback, useState } from 'react';

import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';

/**
 * The kinds of file a command writes, each its own extension: the three a report command writes
 * (decision 8), the owner's snapshot as one HTML page (D4), and the backup (F11), which follows the
 * same rule.
 */
export type FileKind = 'pdf' | 'csv' | 'json' | 'html' | 'ridgebeam';

const FILTER_KEYS: Record<FileKind, MessageKey> = {
  pdf: 'reports.filter.pdf',
  csv: 'reports.filter.csv',
  json: 'reports.filter.json',
  html: 'reports.filter.html',
  ridgebeam: 'backup.filter',
};

export const PATH_KEYS: Record<FileKind, MessageKey> = {
  pdf: 'reports.path.pdf',
  csv: 'reports.path.csv',
  json: 'reports.path.json',
  html: 'reports.path.html',
  ridgebeam: 'backup.path',
};

/** Characters a file name on Windows cannot hold, folded to a space for a suggested name. */
const NOT_IN_A_NAME = /[<>:"/\\|?*]+/g;

/**
 * Where a report is written: a path typed or chosen in the system's save dialog, and the one path
 * the dialog returned — the only file the person agreed may be replaced (F9's rule, decision 8). A
 * typed path that already names a file is refused by the host, never overwritten.
 */
export function useSaveTarget(kind: FileKind, suggestedName: () => string) {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [dialogFailed, setDialogFailed] = useState(false);

  const choose = useCallback(async (): Promise<string | null> => {
    try {
      const typed = path.trim();
      const suggested = `${suggestedName().replace(NOT_IN_A_NAME, ' ').trim()}.${kind}`;
      const picked = await save({
        defaultPath: typed === '' ? suggested : typed,
        filters: [{ name: t(FILTER_KEYS[kind]), extensions: [kind] }],
      });
      setDialogFailed(false);
      if (typeof picked === 'string') {
        setPath(picked);
        setChosen(picked);
        return picked;
      }
    } catch {
      setDialogFailed(true);
    }
    return null;
  }, [kind, path, suggestedName, t]);

  /**
   * The path to write, or the sentence that refuses it before the host is asked: a path must end in
   * this kind's extension.
   */
  const target = ():
    { ok: true; path: string; overwrite: boolean } | { ok: false; problem: string } => {
    const trimmed = path.trim();
    if (!trimmed.toLowerCase().endsWith(`.${kind}`) || trimmed.length <= kind.length + 1) {
      return { ok: false, problem: t('reports.invalid.extension', { extension: kind }) };
    }
    return { ok: true, path: trimmed, overwrite: chosen === trimmed };
  };

  return { kind, path, setPath, choose, dialogFailed, target };
}

export type SaveTarget = ReturnType<typeof useSaveTarget>;
