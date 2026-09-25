import type { LensChoice } from '@/domain/settings';
import type { MessageKey } from '@/i18n/en';

/** What each lens is called on screen — in the title bar and in Settings alike. */
export const LENS_KEYS: Record<LensChoice, MessageKey> = {
  owner: 'settings.lens.owner',
  architect: 'settings.lens.architect',
  engineer: 'settings.lens.engineer',
};
