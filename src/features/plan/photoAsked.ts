/**
 * Whether a check's answer is one that goes with a photo — an inspection, "photos were taken" — so
 * the Gates tab shows its photo field open rather than behind **Add a photo** (F11, decision 8b).
 *
 * A check has no field that says so: it is a name, written by a person, a template or the usual
 * checks, in English or in Portuguese. So this reads the name for the words that ask for a photo in
 * either language. It only decides whether the field starts open; the field is always one press away
 * on every item, so a name it misreads costs a press, never a photo.
 */
const ASKS_FOR_A_PHOTO =
  /\b(photo|photos|photograph|inspect|inspected|inspection|foto|fotos|fotografia|inspecionad[oa]s?|inspe[cç][aã]o|vistori\w*)\b/iu;

export function photoAsked(checkName: string): boolean {
  return ASKS_FOR_A_PHOTO.test(checkName);
}
