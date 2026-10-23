// "Plan this trip" (brief §5, Addresses and people): a context pack for an AI with web search, built from a stay.
// The pack is the one place addresses go to an AI, and people go only when the person ticked them for this request.
// Nothing here calls an AI: the pack is copied or shared, and the reply comes back through "Paste the reply".
import { onPage } from '../domain/places';
import { tasks, projects, places, stays, days, decisions, addresses, people, settings, memory } from '../app/store';
import { isOpen, whereOf, byPriority, categories, planOf, T } from '../app/model';
import { header, projectLines, calibrationLine, stepLines, methodSummary, changesetContract, answerIn, dropInstruction, MAX_STEPS } from './context';
import { lang } from '../i18n';
import { agenda } from '../domain/agenda';
import { pickNotes, noteBlock } from '../domain/memory';
import { preferencesPack } from '../domain/preferences';
import { oneLine as one } from '../domain/lists';
import { tripData, tripInstructions, tripDays } from '../domain/trip';
import type { Stay } from '../data/schema';

export const tripQuestion = () => 'Plan this trip for me.';

export interface TripOptions {
  /** Share the people saved for this place, for this request only. Default: no. */
  people?: boolean;
  drop?: string | null;
  l?: 'en' | 'fr';
}
export interface TripPack { text: string; notes: string[]; days: number }

/** Open steps that belong to the trip: those of the stay's place, due on its days, or waiting on its end; the most pressing first. */
function tripSteps(id: string, st: Stay) {
  return [...tasks.value.values()].filter(x => isOpen(x) && !x.at && (
    whereOf(x) === st.placeId || (!!x.due && x.due >= st.from && x.due <= st.to) || x.dueRule?.beforeEndOf === id
  )).sort((a, b) => byPriority(a, b));
}

const MEMORY_USE = 'It is what the person told Réussite in their own words: use it to understand them, never to draw conclusions about their health, character or anyone\'s private life.';

/** The pack for a stay, or null when the stay is gone. */
export function tripPack(stayId: string, question: string, o: TripOptions = {}): TripPack | null {
  const st = stays.value.get(stayId);
  const place = st && places.value.get(st.placeId);
  if (!st || !place) return null;
  const l = o.l ?? lang.value;
  const dayList = tripDays(st.from, st.to);
  const cats = categories();
  const mine = [...addresses.value.values()].filter(a => a.placeId !== 'any' && onPage(places.value, a.placeId, st.placeId)).sort((a, b) => a.name.localeCompare(b.name));
  const onDay = new Set(dayList);
  // What is already on each day's list, so the AI adds to it rather than starting over.
  const onLists = dayList.map(k => ({ k, steps: planOf(k).map(id => T(id)).filter(x => isOpen(x) && !x.at) }));
  const planned = onLists.filter(d => d.steps.length).map(d => `${d.k}: ${d.steps.map(x => `${x!.id} ${one(x!.title)}`).join('; ')}`);
  const stepList = tripSteps(stayId, st);
  const steps = [...stepList, ...onLists.flatMap(d => d.steps).filter(x => !stepList.includes(x!))].slice(0, MAX_STEPS) as typeof stepList;
  const fixed = agenda({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value }, settings.value, st.from, dayList[dayList.length - 1]!)
    .filter(e => e.kind === 'fixed' && onDay.has(e.day) && e.place !== 'any' && onPage(places.value, e.place, st.placeId))
    .map(e => [e.day, e.time, e.dur ?? '-', one(e.title ?? '')].join(' | '));
  const people_ = o.people ? [...people.value.values()].filter(p => onPage(places.value, p.placeId, st.placeId)).sort((a, b) => a.name.localeCompare(b.name)) : undefined;
  const data = tripData({
    place: { id: place.id, name: place.name }, from: st.from, to: st.to, note: st.note, categories: cats, addresses: mine,
    steps: steps.length ? stepLines(steps, MAX_STEPS).split('\n') : [], fixed, planned, people: people_,
  });
  // The profile and the notes the question, the place or the steps name; the same budget and rule as every request, never a private note.
  const picked = pickNotes({
    notes: memory.value.values(), message: [question, place.name, st.note].join('\n'), tasks: steps, projects: projects.value.values(), budgetTokens: settings.value.memoryBudget,
  });
  const text = [
    'I use Réussite, a planning app built on a CBT method for adults with ADHD. Help me plan a trip, following the method.',
    '## The method, in short\n\n' + methodSummary(l),
    preferencesPack(settings.value.aiPreferences),
    '## My data\n\n' + [header(), projectLines(), data, calibrationLine(steps.map(x => x.app))].filter(Boolean).join('\n\n'),
    picked.length && `## What I have told Réussite about me and my people\n\nNote id | kind | name | aliases, then numbered lines. ${MEMORY_USE}\n\n` + picked.map(noteBlock).join('\n\n'),
    '## How to propose changes\n\n' + changesetContract(),
    '## This trip\n\n' + tripInstructions(place.id, cats.map(c => c.id)),
    '## My question\n\n' + (question.trim() || tripQuestion()),
    `${answerIn(l)} ` + (o.drop
      ? `End your reply with the change-set. ${dropInstruction(o.drop)} Never include weights.`
      : 'End your reply with one fenced code block labelled reussite that holds the change-set. Never include weights.'),
  ].filter(Boolean).join('\n\n');
  return { text, notes: picked.map(n => n.name), days: dayList.length };
}
