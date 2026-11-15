// Setting Réussite up with an AI (S9): a short conversation in which the AI helps the person name the four suits of their days
// (the parts of their days that matter), the places they spend time in and how they want an AI to work with them, and ends in one
// change-set (`settings.update` and `place.create`) on the review screen, inside the app with the person's own key (`setupPrompt`,
// one request for each turn). The copy-and-paste pack for any chatbot is gone (DECISIONS.md 2026-11-15). The AI speaks the app's
// words (cards, suits), as the welcome does (DECISIONS.md 2026-11-14); `pillars` stays the op's field name.
import { z } from 'zod';
import { systemPrompt } from './context';
import { readChangeSet, type Change, type ChangeSet } from './changeset';

/** The ops a setup reply may carry; anything else in it is dropped (a setup creates no cards). */
export const SETUP_OPS: readonly Change['op'][] = ['settings.update', 'place.create'];
/** The exchanges the AI may take before it must propose. */
export const MAX_EXCHANGES = 5;

const WORDS = 'Say "suit" for each of the four, as the app does (each thing they do will be a card in one of them); never "pillar", "category" or "kind of time". Leave the Matrix and its quadrants out: they come later.';

const FIND = `You are helping a new person set Réussite up by talking, so that it fits their life. Find out three things.
1. The four suits: the four parts of their days that matter to them, the ones they would like each day to touch even on a hard day. Start from the four suits a new person is given: Work (job or studies, bureaucracy, paperwork), Leisure (fun, relaxation, consumption, hobbies, outings), Personal projects (side projects, chores, research) and Interpersonal obligations (functions and services for family and friends). Keep them as they are unless the person says another name fits their life better; then use their own words in at most four words. Always four: if they name more than four, ask which four matter most; if fewer, ask one question about the missing part and let them decide. Order them as they matter to the person, the one they would miss most first.
2. The places: where they spend time (home, work, a second home, a city they visit often). Names only.
3. How they want an AI to work with them: how long its answers should be ("very short", "short" or "full"), something to know about how they work, something it should never do. Leave out what they did not say.`;

const HOW = `Talk plainly and warmly, one question at a time, starting from their life ("tell me about a usual week") and not from the app. ${WORDS} Facts, no praise, no guilt, no advice about their health, nothing about what they should have done. Take at most ${MAX_EXCHANGES} exchanges. As soon as you have the four suits, give the change-set in the same reply: the person sees every line and can untick one or go back and correct you, so do not ask for a yes first.`;

const CHANGES = `The change-set sets everything up, with these two ops only:
- {"op": "settings.update", "set": {"pillars": [{"name": "...", "short": "one word or two"}, ... the four suits, in order], "preferences": {"detail": "very short|short|full", "know": "...", "never": "..."}}} (leave out "preferences", or any key of it, if the person said nothing about it).
- {"op": "place.create", "set": {"name": "Home"}} for each place, with no time zone.`;

/** The task for the in-app conversation: JSON in, JSON out. */
const TASK = `${FIND}

${HOW}

${CHANGES}

Reply with JSON only: {"say": "what you say next to the person: one question, or, with the change-set, two or three lines of what you understood", "changes": []}. "changes" stays an empty list while you are still asking, and holds the change-set's changes (as above) in the reply where you propose.`;

export const SetupReply = z.object({ say: z.string().optional(), note: z.string().optional(), changes: z.array(z.unknown()).max(40).optional() });
export type SetupReplyT = z.infer<typeof SetupReply>;

export interface Turn { who: 'you' | 'me'; text: string }
const one = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * One turn of the conversation: the person's words so far, in order, then what they have just said. `turns` ends with
 * the person's latest message. Nothing of their deck is sent: on a first run there is none.
 */
export function setupPrompt(turns: Turn[]): { system: { stable: string; rest: string }; user: string; notes: string[] } {
  const system = systemPrompt(TASK);
  const said = turns.slice(-16).map(x => (x.who === 'me' ? 'Person: ' : 'You: ') + one(x.text).slice(0, 1200));
  const mine = turns.filter(x => x.who === 'me').length;
  const user = [
    `The conversation so far (${mine} message${mine === 1 ? '' : 's'} from the person${mine >= MAX_EXCHANGES ? `; that is the limit of ${MAX_EXCHANGES}: propose the change-set now` : ''}):`,
    ...said,
    'Reply with the JSON.',
  ].join('\n');
  return { system, user, notes: [] };
}

/** What a reply says to the person, and the change-set it holds (only the setup ops), or null while the AI is still asking. */
export function readSetup(r: SetupReplyT | null): { say: string; cs: ChangeSet | null } {
  const say = one(r?.say ?? r?.note ?? '');
  const changes = (r?.changes ?? []).filter(c => !!c && typeof c === 'object' && SETUP_OPS.includes((c as { op?: Change['op'] }).op as Change['op']));
  if (!changes.length) return { say, cs: null };
  const p = readChangeSet({ v: 1, note: say, changes });
  return { say, cs: p.ok ? p.cs : null };
}

