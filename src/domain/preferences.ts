// How an AI should work with the person (brief §15, docs/ai/preferences.md): a short text of their own,
// added to every AI request and to the Ask any AI and trip packs. The template's fixed lines are the
// default; onboarding fills the two free lines and the level of detail, and Settings → AI edits the text.

export type Detail = 'very short' | 'short' | 'full';
export const DETAILS: readonly Detail[] = ['very short', 'short', 'full'];

/** The lines the template keeps for everyone. They are English because every prompt is. */
const CORE = [
  'One question at a time. Ask one question, then wait.',
  'Facts about progress, never praise of character. Say "4 steps, 2 h 10", not "you\'re great". No streaks.',
  'No guilt. No "you should have". Don\'t comment on what didn\'t get done.',
  'Don\'t ask how I feel about things I didn\'t raise. A non-answer is not data.',
  'Push back on avoidance. If I research instead of asking, ask for more options when there are enough, ruminate, browse during a work block, or tinker with the tools instead of the list, say so plainly, once, and give me the first step. See "Insisting" in the method.',
];

export interface PreferenceForm { detail: Detail; know: string; never: string }
export const DEFAULT_FORM: PreferenceForm = { detail: 'short', know: '', never: '' };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const detailLine = (d: Detail) => (d === 'full' ? 'Level of detail: full explanations.' : `Level of detail: ${d}.`);

/** The text for a filled-in form: the fixed lines, the level of detail, and a line for each free field that has words. */
export function buildPreferences(f: PreferenceForm = DEFAULT_FORM): string {
  const know = oneLine(f.know), never = oneLine(f.never);
  return [...CORE, detailLine(DETAILS.includes(f.detail) ? f.detail : 'short'), know && `Things to know about how I work: ${know}`, never && `Things never to do: ${never}`]
    .filter(Boolean).map(l => '- ' + l).join('\n');
}

/** What a new settings document holds, and what "Use the template again" puts back. */
export const DEFAULT_PREFERENCES = buildPreferences();

/** The text as it goes in a request: trimmed, and empty when the person emptied it (then nothing is sent for it). */
export const preferencesText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The stable system part's paragraph; empty without preferences. */
export function preferencesSystem(v: unknown): string {
  const text = preferencesText(v);
  return text ? 'How the person wants an AI to work with them, in their own words. They shape how you word a note or a reply; they never change the reply format the task asks for.\n\n' + text : '';
}

/** The pack's section; empty without preferences. */
export function preferencesPack(v: unknown): string {
  const text = preferencesText(v);
  return text ? '## How I want you to work with me\n\n' + text : '';
}
