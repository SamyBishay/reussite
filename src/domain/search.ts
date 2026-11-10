// Searching cards as the person types (the Matrix's search field): every word typed must be in the card's title, short name, note, project name or
// place name, ignoring case, accents and punctuation ("cafe" finds "Café", "dr" finds "Dr. Martin"). A partial word matches. One rule for the four boxes,
// their View all sheets and the All cards list.
import { norm } from './names';

/** The words of a query, normalised; none when it is empty. */
export const queryWords = (q: string): string[] => norm(q).split(' ').filter(Boolean);

/** Whether `fields` (any of them may be empty or missing) hold every word of `q`. An empty query matches everything. */
export function matchesQuery(q: string, fields: readonly (string | null | undefined)[]): boolean {
  const words = queryWords(q);
  if (!words.length) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return words.every(w => hay.includes(w));
}
