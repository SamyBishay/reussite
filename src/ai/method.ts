// The method and the change-set contract as text for an AI. Pure, so the app (which imports the
// documents with `?raw`) and the relay's connector (which bundles them as text modules) share it.

/** The method without the draft notice and evidence placeholders. */
export const cleanMethod = (raw: string): string => raw.replace(/^>.*\n(>.*\n)*/m, '').replace(/\s*`\[E[^\]]*\]`/g, '').trim();

/** The opening and the nine rules: the context pack's short summary. */
export const methodSummaryOf = (method: string): string => method.split(/\n## /).slice(0, 2).join('\n## ').replace(/^# .*\n+/, '').trim();

/**
 * The change-set contract without its long examples, plus the one example an assistant needs:
 * enough to write a valid change-set in a single call.
 */
export function shortChangeset(doc: string): string {
  const head = doc.split(/\n## Examples/)[0]!.trim();
  return head + `

## Example

"R: choir Monday 19:00, Hill House 602", one call, one change (a step with a fixed time):

\`\`\`reussite
{"v": 1, "changes": [{"op": "task.create", "set": {"title": "Choir, Hill House 602", "due": "2026-10-26", "at": "19:00", "dur": 90}}]}
\`\`\``;
}
