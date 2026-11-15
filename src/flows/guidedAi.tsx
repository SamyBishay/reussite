// The guided set-up of one way of a cloud AI, from Settings → How Réussite understands you: a key and a conversation, or the person's AI chat app
// through the connector, in a sheet. Loaded when asked for (it shares its pieces with set-up, which imports Settings' key field).
import { openSheet } from '../app/sheet';
import type { Entry } from './onboarding';

export async function openGuidedAi(entry: Entry): Promise<void> {
  const { Onboarding } = await import('./onboarding');
  openSheet(<Onboarding key={'ga' + Date.now()} entry={entry} />, true);
}
