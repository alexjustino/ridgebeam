import { describe, expect, it } from 'vitest';

import { en } from '@/i18n/en';
import { ptBR } from '@/i18n/pt-BR';

import { photoAsked } from './photoAsked';

/**
 * The Gates tab keeps each item's photo field behind **Add a photo**, open from the start only where
 * the answer goes with a photo (F11, decision 8b) — read from the check's name, in either language.
 */
describe('which checks open their photo field', () => {
  it.each([
    en['checks.default.close.inspected'],
    en['checks.default.close.photosTaken'],
    ptBR['checks.default.close.inspected'],
    ptBR['checks.default.close.photosTaken'],
    'Were photos taken of the pipes and cables before the walls were closed?',
    'Foram tiradas fotos dos tubos e cabos antes de fechar as paredes?',
    'O proprietário vistoriou o banheiro e aprovou a lista de pendências?',
    'Was the old timber inspected, and every rotten or broken piece marked?',
  ])('opens it for "%s"', (name) => {
    expect(photoAsked(name)).toBe(true);
  });

  it.each([
    en['checks.default.close.ownerWalked'],
    en['checks.default.close.wasteRemoved'],
    en['checks.default.start.materialsOnSite'],
    ptBR['checks.default.close.ownerWalked'],
    ptBR['checks.default.start.previousClosed'],
    'Photography studio booked',
  ])('keeps it behind the button for "%s"', (name) => {
    expect(photoAsked(name)).toBe(false);
  });
});
