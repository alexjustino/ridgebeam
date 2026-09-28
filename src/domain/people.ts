/**
 * People: the contacts of a work, the stages they are expected on, and when the diary says they
 * were on site.
 *
 * **A person is a row, never a user.** No accounts, no logins. A phone number and an e-mail address
 * are text the person typed: kept as typed, checked for length only, never dialled, never written
 * to. The product has no network.
 *
 * **Presence comes from the diary.** The stages a person is expected on are the plan's intent; the
 * days they were on site are the diary's facts, read from the effective entries (a corrected entry's
 * "present" no longer counts; its correction's does).
 *
 * What this module is not: storage or text. It returns rows and codes.
 */

import { effectiveEntries, type DiaryEntry } from './diary';
import type { Figure } from './figure';
import { owedOf, type MoneyRow } from './money';
import { compareText, stagesInOrder, type Person, type WorkSnapshot } from './plan';

/** Every day an effective entry says this person was on site, oldest first, each once. */
export function daysOnSite(person: Person, entries: readonly DiaryEntry[]): string[] {
  const days = new Set(
    effectiveEntries(entries)
      .filter((entry) => entry.present.includes(person.id))
      .map((entry) => entry.day),
  );
  return [...days].sort(compareText);
}

/** The last day the diary says this person was on site, or `null` when it never did. */
export function lastOnSite(person: Person, entries: readonly DiaryEntry[]): string | null {
  return daysOnSite(person, entries).at(-1) ?? null;
}

/** One line of the People tab. */
export interface ContactRow {
  readonly personId: string;
  readonly name: string;
  readonly trade: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly note: string | null;
  readonly availability: string | null;
  /** The stages they are expected on that the plan has, in plan order. */
  readonly stageIds: readonly string[];
  /** Stages they were put on that are no longer in the plan: listed, never dropped. */
  readonly stagesGone: readonly string[];
  /** The days the diary says they were on site, oldest first. */
  readonly daysOnSite: readonly string[];
  readonly lastOnSite: string | null;
  /** What is still owed to them: committed to them less paid to them, with its rows. */
  readonly owed: Figure<MoneyRow>;
}

/** The People tab: everyone, by name, with their stages, their days on site and what is owed. */
export function peopleTable(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]): ContactRow[] {
  const planStages = stagesInOrder(snapshot).map((stage) => stage.id);
  const known = new Set(planStages);
  return [...snapshot.people]
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
    .map((person) => {
      const days = daysOnSite(person, entries);
      return {
        personId: person.id,
        name: person.name,
        trade: person.trade,
        phone: person.phone,
        email: person.email,
        note: person.note,
        availability: person.availability,
        stageIds: planStages.filter((id) => person.stageIds.includes(id)),
        stagesGone: [...new Set(person.stageIds.filter((id) => !known.has(id)))],
        daysOnSite: days,
        lastOnSite: days.at(-1) ?? null,
        owed: owedOf(snapshot, { kind: 'person', personId: person.id }),
      };
    });
}

/** A change to a person, as the People card sends it. Every field is optional. */
export interface ContactPatch {
  readonly name?: string;
  readonly trade?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly note?: string | null;
  readonly availability?: string | null;
  readonly stageIds?: readonly string[];
}

export type ContactProblem =
  | { readonly code: 'name-empty' }
  | { readonly code: 'too-long'; readonly field: keyof typeof CONTACT_LIMITS }
  | { readonly code: 'unknown-stage'; readonly stageId: string };

/** The longest each field may be, in characters. */
export const CONTACT_LIMITS = {
  name: 120,
  trade: 60,
  phone: 40,
  email: 120,
  note: 500,
  availability: 200,
} as const;

/**
 * Check a change to a person before the host is asked. Lenient on purpose: a phone number or an
 * e-mail address is checked for length only, because it is text the person typed, not something the
 * product uses. Refused: an empty name, a field over its limit, a stage the plan does not have.
 * Never throws; every problem is reported.
 */
export function validateContact(patch: ContactPatch, snapshot: WorkSnapshot): ContactProblem[] {
  const problems: ContactProblem[] = [];
  if (patch.name !== undefined && patch.name.trim() === '') problems.push({ code: 'name-empty' });
  for (const field of Object.keys(CONTACT_LIMITS) as Array<keyof typeof CONTACT_LIMITS>) {
    const value = patch[field];
    if (typeof value === 'string' && value.length > CONTACT_LIMITS[field]) {
      problems.push({ code: 'too-long', field });
    }
  }
  const stages = new Set(snapshot.stages.map((stage) => stage.id));
  for (const stageId of patch.stageIds ?? []) {
    if (!stages.has(stageId)) problems.push({ code: 'unknown-stage', stageId });
  }
  return problems;
}
