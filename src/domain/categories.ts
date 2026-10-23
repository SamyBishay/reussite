// The address categories the person edits in Settings (brief §5): rename, add, reorder, remove. Ids never
// change (addresses keep them); an empty name means the app's own word for a default. Pure.
import type { AddressCategory } from '../data/settings';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/** A new category at the end, with an id no category has (and none an address might still carry from a removed one: `taken`). */
export function addCategory(list: readonly AddressCategory[], name: string, taken: Iterable<string> = []): AddressCategory[] {
  const n = name.trim();
  if (!n) return [...list];
  const used = new Set([...list.map(c => c.id), ...taken]);
  const base = slug(n) || 'cat';
  let id = base, i = 2;
  while (used.has(id)) id = base + '-' + i++;
  return [...list, { id, name: n }];
}

/** A category's new name; an empty one gives it back its default word. */
export const renameCategory = (list: readonly AddressCategory[], id: string, name: string): AddressCategory[] => list.map(c => (c.id === id ? { ...c, name: name.trim() } : c));

export const removeCategory = (list: readonly AddressCategory[], id: string): AddressCategory[] => list.filter(c => c.id !== id);

/** One place up or down; at an end, nothing. */
export function moveCategory(list: readonly AddressCategory[], id: string, dir: -1 | 1): AddressCategory[] {
  const i = list.findIndex(c => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
