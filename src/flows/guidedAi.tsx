// The guided AI set-up, from Settings: the screens first-run set-up used to open on its first page (a key and a conversation, the person's AI chat app through the
// connector, any chatbot by copy and paste), in a sheet. Loaded when asked for (it shares its pieces with set-up, which imports Settings' key field).
import { openSheet } from '../app/sheet';
import type { Entry } from './onboarding';

export async function openGuidedAi(entry: Entry = 'ways'): Promise<void> {
  const { Onboarding } = await import('./onboarding');
  openSheet(<Onboarding key={'ga' + Date.now()} entry={entry} />, true);
}
