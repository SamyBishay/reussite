// "Plan this trip" (brief §5, Addresses and people): one request to the AI the person set up with their own key, built from a stay. Its change-set
// opens on the review screen like every AI change. This request is the one place addresses go to an AI, and people go only when the person ticked
// them for this request. With the connector and no key the app makes no request: it gives the sentence to say in the chat app (ChatOffer).
import { onPage } from '../domain/places';
import { tasks, projects, places, stays, days, decisions, addresses, people, settings, memory } from '../app/store';
import { isOpen, whereOf, byPriority, categories, planOf, T } from '../app/model';
import { header, projectLines, calibrationLine, stepLines, changesetContract, systemPrompt, MAX_STEPS } from './context';
import { lang } from '../i18n';
import { agenda } from '../domain/agenda';
import { pickNotes, noteBlock } from '../domain/memory';
import { oneLine as one } from '../domain/lists';
import { tripData, tripInstructions, tripDays } from '../domain/trip';
import type { Stay } from '../data/schema';

export const tripQuestion = () => 'Plan this trip for me.';

export interface TripOptions {
  /** Share the people saved for this place, for this request only. Default: no. */
  people?: boolean;
  l?: 'en' | 'fr';
}
export interface TripPrompt { system: { stable: string; rest: string }; user: string; notes: string[]; days: number }

/** Open steps that belong to the trip: those of the stay's place, due on its days, or waiting on its end; the most pressing first. */
function tripSteps(id: string, st: Stay) {
  return [...tasks.value.values()].filter(x => isOpen(x) && !x.at && (
    whereOf(x) === st.placeId || (!!x.due && x.due >= st.from && x.due <= st.to) || x.dueRule?.beforeEndOf === id
  )).sort((a, b) => byPriority(a, b));
}

const MEMORY_USE = 'It is what the person told Réussite in their own words: use it to understand them, never to draw conclusions about their health, character or anyone\'s private life.';

/** The request for a stay, or null when the stay is gone. */
export function tripPrompt(stayId: string, question: string, o: TripOptions = {}): TripPrompt | null {
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
  const rest = picked.filter(n => n.kind !== 'profile');
  const system = systemPrompt(`Help the person plan a trip. ${tripInstructions(place.id, cats.map(c => c.id))}\n\nReply with the change-set JSON only, no prose; put what you want to say in "note". Never include weights.\n\n${changesetContract()}`, l);
  const user = [
    header(), projectLines(), data, calibrationLine(steps.map(x => x.app)),
    rest.length ? `Memory (note id | kind | name | aliases, then numbered lines). ${MEMORY_USE}\n\n` + rest.map(noteBlock).join('\n\n') : '',
    'Request:\n' + (question.trim() || tripQuestion()),
  ].filter(Boolean).join('\n\n');
  return { system, user, notes: picked.map(n => n.name), days: dayList.length };
}
