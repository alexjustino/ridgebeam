/**
 * What a drop does, decided before anything is done (slice U1, decision 1): **drop is choose**.
 *
 * Files dragged from Explorer onto the window arrive as absolute paths, the same paths the system's
 * file dialog would have returned had the person chosen them there. So a drop is routed to the place
 * that already takes chosen paths on the screen it lands on — the photos of the entry being written
 * on the Diary, the work's documents on Documents — and to nothing anywhere else. Nothing new
 * reaches the host: a dropped path goes through the same intake as a chosen one.
 *
 * Each place takes what its dialog offers and nothing more: the dialog filters by these extensions,
 * so a drop does too. A folder cannot be told from a file by its path alone — the interface has no
 * way to look — so a folder is left out with everything else the dialog would not have offered,
 * named, and a folder whose name happens to end like a photo is still refused by the host, by name,
 * in its own sentence. The dialog has no cap on how many files it returns, and neither has a drop;
 * a path dropped twice is taken once, as the dialog's list keeps it.
 *
 * Pure: a screen, a fact about the work and some paths in, a decision out.
 */

import type { Destination } from './destinations';

/** What the photo dialog offers — the Diary's "Add photos…". */
export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] as const;

/** What the documents dialog offers — photos and PDFs. */
export const DOCUMENT_EXTENSIONS = [...PHOTO_EXTENSIONS, 'pdf'] as const;

/** The places on screen a drop can be taken in. */
export type DropPlace = 'diary' | 'documents';

const ACCEPTS: Record<DropPlace, ReadonlySet<string>> = {
  diary: new Set(PHOTO_EXTENSIONS),
  documents: new Set(DOCUMENT_EXTENSIONS),
};

/** What a drop on the current screen does. */
export type DropRoute =
  | {
      readonly kind: 'take';
      readonly place: DropPlace;
      /** The paths taken, in the order dropped, each once. */
      readonly taken: readonly string[];
      /** The names of what is left out — a folder, or a file the dialog would not have offered. */
      readonly refused: readonly string[];
    }
  | {
      readonly kind: 'nowhere';
      /** No work is open, or this screen takes no file. */
      readonly why: 'no-work' | 'elsewhere';
    };

/** A path without the separators a folder dropped from Explorer may end with. */
function trimmed(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

/** The last part of a path, whichever separator the person's system uses. */
export function baseName(path: string): string {
  const whole = trimmed(path);
  return whole.split(/[\\/]/).pop() || whole;
}

/** The extension of a path's last part, lowercased; `null` when it has none. */
function extensionOf(path: string): string | null {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? null : name.slice(dot + 1).toLowerCase();
}

/** The place a destination takes dropped files in, or `null` when it takes none. */
export function dropPlaceOf(destination: Destination): DropPlace | null {
  return destination === 'diary' || destination === 'documents' ? destination : null;
}

/**
 * Route dropped paths: the destination on screen and whether a work is open decide the place; the
 * place's dialog decides which paths it takes. Never throws, never reorders, never drops a path
 * silently — each one is either taken or named as refused.
 */
export function routeDrop({
  destination,
  workOpen,
  paths,
}: {
  destination: Destination;
  workOpen: boolean;
  paths: readonly string[];
}): DropRoute {
  if (!workOpen) return { kind: 'nowhere', why: 'no-work' };
  const place = dropPlaceOf(destination);
  if (place === null) return { kind: 'nowhere', why: 'elsewhere' };

  const accepts = ACCEPTS[place];
  const taken: string[] = [];
  const refused: string[] = [];
  for (const path of paths) {
    const extension = extensionOf(path);
    if (extension !== null && accepts.has(extension)) {
      if (!taken.includes(path)) taken.push(path);
    } else {
      const name = baseName(path);
      if (!refused.includes(name)) refused.push(name);
    }
  }
  return { kind: 'take', place, taken, refused };
}
