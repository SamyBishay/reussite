// Finding things by name: a step, a project, a place, a memory note. Matching ignores case, accents
// and punctuation. Shared by the connector, the local parser and memory matching.

export const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface Named { id: string; name: string }
export type Found = { id: string } | { none: true } | { many: Named[] };

/** Exact match first, then a unique prefix of whole words ("choir" finds "Choir dues", "cho" finds nothing). `pool` are the things that may be meant. */
export function findByName(value: string, pool: Named[]): Found {
  const want = norm(value);
  if (!want) return { none: true };
  const exact = pool.filter(p => norm(p.name) === want);
  if (exact.length === 1) return { id: exact[0]!.id };
  if (exact.length > 1) return { many: exact };
  const pre = pool.filter(p => (norm(p.name) + ' ').startsWith(want + ' '));
  if (pre.length === 1) return { id: pre[0]!.id };
  if (pre.length > 1) return { many: pre };
  return { none: true };
}
