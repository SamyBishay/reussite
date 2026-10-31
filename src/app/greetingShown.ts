// Which greeting lines Home already said today (src/domain/greeting.ts, `pickGreeting`): a list of template keys in the
// order they were said, kept on this device under the day, so opening Home again says something else. It resets by itself
// with the day (a new day has a new key; the old ones are dropped when a line is written). Without storage (a private
// window, blocked site data) it still works: the line is simply not remembered.
const PREFIX = 'reussite.greet.';

export function shownGreetings(day: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PREFIX + day) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function rememberGreeting(day: string, key: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== PREFIX + day) localStorage.removeItem(k);
    }
    localStorage.setItem(PREFIX + day, JSON.stringify([...shownGreetings(day), key].slice(-50)));
  } catch { /* fine: it is just not remembered */ }
}
