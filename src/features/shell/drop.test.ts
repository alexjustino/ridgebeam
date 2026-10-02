import { describe, expect, it } from 'vitest';

import { DESTINATIONS } from './destinations';
import { baseName, dropPlaceOf, routeDrop } from './drop';

/**
 * What a drop does (U1, decision 1): drop is choose. The screen on show and whether a work is open
 * decide the place; the place's own dialog decides which paths it takes; everything else is named.
 */

const PHOTO = 'C:\\Users\\sample\\Pictures\\site 01.JPG';
const PDF = 'C:\\Users\\sample\\Documents\\quote.pdf';
const FOLDER = 'C:\\Users\\sample\\Pictures\\Week 1';
const OTHER = 'C:\\Users\\sample\\Documents\\notes.docx';

describe('routing a drop', () => {
  it('takes photos on the Diary, for the entry being written, in the order dropped', () => {
    expect(
      routeDrop({ destination: 'diary', workOpen: true, paths: [PHOTO, '/tmp/b.png'] }),
    ).toEqual({ kind: 'take', place: 'diary', taken: [PHOTO, '/tmp/b.png'], refused: [] });
  });

  it('leaves out on the Diary what its dialog would not offer — a PDF, a folder — by name', () => {
    expect(
      routeDrop({ destination: 'diary', workOpen: true, paths: [PDF, PHOTO, FOLDER, OTHER] }),
    ).toEqual({
      kind: 'take',
      place: 'diary',
      taken: [PHOTO],
      refused: ['quote.pdf', 'Week 1', 'notes.docx'],
    });
  });

  it('takes photos and PDFs on Documents, and leaves out a folder and anything else', () => {
    expect(
      routeDrop({ destination: 'documents', workOpen: true, paths: [PDF, FOLDER, PHOTO, OTHER] }),
    ).toEqual({
      kind: 'take',
      place: 'documents',
      taken: [PDF, PHOTO],
      refused: ['Week 1', 'notes.docx'],
    });
  });

  it('names a folder dropped with a trailing separator, and one whose name has a dot', () => {
    const route = routeDrop({
      destination: 'documents',
      workOpen: true,
      paths: ['D:\\Site\\Week 2\\', '/home/sample/v1.2/', 'D:\\Site\\.hidden'],
    });
    expect(route).toMatchObject({ taken: [], refused: ['Week 2', 'v1.2', '.hidden'] });
  });

  it('takes a path dropped twice once, as the dialog’s list keeps it', () => {
    expect(
      routeDrop({ destination: 'diary', workOpen: true, paths: [PHOTO, PHOTO, FOLDER, FOLDER] }),
    ).toMatchObject({ taken: [PHOTO], refused: ['Week 1'] });
  });

  it('takes nothing on any other screen, and says so', () => {
    for (const destination of DESTINATIONS.filter((each) => dropPlaceOf(each) === null)) {
      expect(routeDrop({ destination, workOpen: true, paths: [PHOTO] })).toEqual({
        kind: 'nowhere',
        why: 'elsewhere',
      });
    }
  });

  it('takes nothing with no work open, whatever the screen', () => {
    for (const destination of DESTINATIONS) {
      expect(routeDrop({ destination, workOpen: false, paths: [PHOTO] })).toEqual({
        kind: 'nowhere',
        why: 'no-work',
      });
    }
  });

  it('has a place for exactly the Diary and Documents', () => {
    expect(DESTINATIONS.filter((each) => dropPlaceOf(each) !== null)).toEqual([
      'diary',
      'documents',
    ]);
  });

  it('reads a path’s last part whichever separator it uses', () => {
    expect(baseName('C:\\a\\b.png')).toBe('b.png');
    expect(baseName('/a/b/')).toBe('b');
    expect(baseName('b.png')).toBe('b.png');
  });
});
