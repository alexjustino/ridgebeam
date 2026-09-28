import type { DocumentKind } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';

/** What each kind of document is called on screen. */
export const KIND_KEYS: Record<DocumentKind, MessageKey> = {
  photo: 'document.kind.photo',
  quote: 'document.kind.quote',
  drawing: 'document.kind.drawing',
  permit: 'document.kind.permit',
  receipt: 'document.kind.receipt',
  contract: 'document.kind.contract',
  other: 'document.kind.otherKind',
};
