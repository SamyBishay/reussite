// The first card (14 Nov): the one a new person writes during set-up. Today shows one line above it while it is
// to play, and one small card once it is played (with the offer of a morning reminder), then nothing ever again.
// Kept on this device only (localStorage): it is about this person's first minutes here, not about their list.
import { signal } from '@preact/signals';

const KEY = 'reussite.firstcard';
const read = (): string | null => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

/** The id of the first card, until its small card on Today is put away. */
export const firstCard = signal<string | null>(read());

export function setFirstCard(id: string) {
  firstCard.value = id;
  try { localStorage.setItem(KEY, id); } catch { /* it then shows for this visit only */ }
}

export function dismissFirstCard() {
  firstCard.value = null;
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
}
