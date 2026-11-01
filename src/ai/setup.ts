// Setting Réussite up with an AI (S9): a short conversation in which the AI helps the person name the four pillars of their days
// ("what matters in your days"), the places they spend time in and how they want an AI to work with them, and ends in one
// change-set (`settings.update` and `place.create`) on the review screen. Two ways in, one contract: inside the app with a key
// (`setupPrompt`, one request for each turn), or in any chatbot by copy and paste (`setupPack`, the reply comes back through
// Paste the reply). No cards, suits or Matrix vocabulary reaches the person.
import { z } from 'zod';
import { systemPrompt, methodSummary, answerIn } from './context';
import { readChangeSet, type Change, type ChangeSet } from './changeset';
import { preferencesPack } from '../domain/preferences';
import { settings } from '../app/store';
import { lang } from '../i18n';

/** The ops a setup reply may carry; anything else in it is dropped (a setup creates no steps). */
export const SETUP_OPS: readonly Change['op'][] = ['settings.update', 'place.create'];
/** The exchanges the AI may take before it must propose. */
export const MAX_EXCHANGES = 5;

const WORDS = 'Never say "card", "suit", "matrix", "quadrant" or "category" to the person: say "what matters in your days", and "pillar" only when you propose the four.';

const FIND = `You are helping a new person set Réussite up by talking, so that it fits their life. Find out three things.
1. The four pillars: the four parts of their days that matter to them, the ones they would like each day to touch even on a hard day. Take them from what they tell you of their life (work or studies, home and money, the people they love, their body and rest, something creative or spiritual), and name each in their own words in at most four words ("The thesis", "My kids", "Health"). Always four: if they name more than four, ask which four matter most; if fewer, ask one question about the missing part and let them decide. Order them as they matter to the person, the one they would miss most first.
2. The places: where they spend time (home, work, a second home, a city they visit often). Names only.
3. How they want an AI to work with them: how long its answers should be ("very short", "short" or "full"), something to know about how they work, something it should never do. Leave out what they did not say.`;

const HOW = `Talk plainly and warmly, one question at a time, starting from their life ("tell me about a usual week") and not from the app. ${WORDS} Facts, no praise, no guilt, no advice about their health, nothing about what they should have done. Take at most ${MAX_EXCHANGES} exchanges. As soon as you have the four pillars, give the change-set in the same reply: the person sees every line and can untick one or go back and correct you, so do not ask for a yes first.`;

const CHANGES = `The change-set sets everything up, with these two ops only:
- {"op": "settings.update", "set": {"pillars": [{"name": "...", "short": "one word or two"}, ... four of them], "preferences": {"detail": "very short|short|full", "know": "...", "never": "..."}}} (leave out "preferences", or any key of it, if the person said nothing about it).
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
 * the person's latest message. Nothing of their list is sent: on a first run there is none.
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

/**
 * A change-set read from a pasted reply, cut back to the setup ops (a chatbot told only what it needs, but a pasted block is
 * anyone's): null when nothing of it is a setup change.
 */
export function onlySetup(cs: ChangeSet): ChangeSet | null {
  const changes = cs.changes.filter(c => SETUP_OPS.includes(c.op));
  return changes.length ? { ...cs, changes } : null;
}

/** The first thing the AI says is the app's own, so nothing is sent until the person has written. */
export const FIRST_MESSAGE_KEY = 'obChatFirst' as const;

const FIND_PACK = `Find out three things from me, by talking, so that Réussite fits my life.
1. My four pillars: the four parts of my days that matter to me, the ones I would like each day to touch even on a hard day. Take them from what I tell you of my life (work or studies, home and money, the people I love, my body and rest, something creative or spiritual), and name each in my own words in at most four words ("The thesis", "My kids", "Health"). Always four: if I name more than four, ask which four matter most; if fewer, ask one question about the missing part and let me decide. Order them as they matter to me, the one I would miss most first.
2. My places: where I spend time (home, work, a second home, a city I visit often). Names only.
3. How I want an AI to work with me: how long its answers should be ("very short", "short" or "full"), something to know about how I work, something it should never do. Leave out what I did not say.`;

const HOW_PACK = `Talk plainly and warmly, one question at a time, starting from my life ("tell me about a usual week") and not from the app. ${WORDS} Facts, no praise, no guilt, no advice about my health, nothing about what I should have done. Take at most ${MAX_EXCHANGES} exchanges. As soon as you have my four pillars, end your reply with the change-set below: I will see every line in Réussite and can untick one or come back to you, so do not ask for a yes first. Do not call any tool or connector for this: give me the block.`;

/**
 * The text to paste into any chatbot (Claude, ChatGPT, anything): the same job as the in-app conversation, ending with one
 * fenced block labelled `reussite` for Paste the reply. It holds no data of the person's, only the method in short and their
 * lines for an AI if they have any.
 */
export function setupPack(l = lang.value): string {
  return [
    'I am setting up Réussite, a planning app built on a CBT method for adults with ADHD. Help me do it by talking with me, following the method and its tone.',
    '## The method, in short\n\n' + methodSummary(l),
    preferencesPack(settings.value.aiPreferences),
    '## What I need from you\n\n' + FIND_PACK,
    '## How to talk to me\n\n' + HOW_PACK,
    '## How to give me the result\n\n' + CHANGES + '\n\nEnd your reply with one fenced code block labelled reussite that holds this JSON: {"v": 1, "note": "one short line", "changes": [ ... ]}. Never include weights or anything else.',
    `${answerIn(l)} Start now: say hello in one line and ask me your first question.`,
  ].filter(Boolean).join('\n\n');
}
