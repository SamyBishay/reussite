// Tonight's copy of a standing series. A series made after the morning check-in (by hand, by an AI, or arriving by sync) has no card on
// today's list until the next check-in, though its day and time are today's: this puts its copy on the list once, as soon as the
// series and the clock say it is due (src/domain/agenda.ts `standingToPlace`, src/app/actions.ts `placeStandingToday`).
import { effect } from '@preact/signals';
import { clockNow, days, places, ready, readOnly, settings, stays, tasks, today } from './store';
import { placeStandingToday } from './actions';

let started = false;
export function watchStanding(): void {
  if (started) return;
  started = true;
  effect(() => {
    void [tasks.value, days.value, places.value, stays.value, settings.value, today.value, clockNow.value];
    if (ready.value && !readOnly.value) void placeStandingToday();
  });
}
