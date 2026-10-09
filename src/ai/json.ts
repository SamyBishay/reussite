// Pulling JSON out of a model's reply: a fenced block (```reussite, ```json or bare ```),
// else the first balanced {…} or […] in the text. Pure; no I/O.

const FENCE = /```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g;

/** Fenced blocks in order, with their label (lower case, '' when none). */
export function fences(text: string): { label: string; body: string }[] {
  const out: { label: string; body: string }[] = [];
  for (const m of text.matchAll(FENCE)) out.push({ label: (m[1] ?? '').toLowerCase(), body: m[2] ?? '' });
  return out;
}

/** The first balanced JSON object or array in `s`, respecting strings. */
export function balanced(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    let depth = 0, str = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) { const cand = s.slice(i, j + 1); if (tryParse(cand) !== undefined) return cand; break; } }
    }
  }
  return null;
}

function tryParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

/**
 * Parse the JSON in a reply. `prefer` names a fence label to look for first (e.g. 'reussite').
 * Returns undefined when nothing parses.
 */
export function extractJson(text: string, prefer?: string): unknown {
  const fs = fences(text);
  const order = [...fs.filter(f => prefer && f.label === prefer), ...fs.filter(f => f.label === 'json'), ...fs.filter(f => !prefer || f.label !== prefer)];
  for (const f of order) {
    const v = tryParse(f.body.trim());
    if (v !== undefined) return v;
    const b = balanced(f.body);
    if (b) return JSON.parse(b);
  }
  const whole = tryParse(text.trim());
  if (whole !== undefined && typeof whole === 'object') return whole;
  const b = balanced(text);
  return b ? JSON.parse(b) : undefined;
}
