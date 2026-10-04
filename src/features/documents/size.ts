import type { I18n } from '@/i18n/useI18n';

/**
 * A file's size in words a person reads — "340 KB", "12,5 MB" — never a byte count, and never "0 KB"
 * for a file that holds something.
 */
export function sizeText({ t, number }: Pick<I18n, 't' | 'number'>, bytes: number): string {
  return bytes >= 1024 * 1024
    ? t('documents.size.mb', { value: number(Math.round((bytes / 1024 / 1024) * 10) / 10) })
    : t('documents.size.kb', { value: number(Math.max(1, Math.round(bytes / 1024))) });
}
