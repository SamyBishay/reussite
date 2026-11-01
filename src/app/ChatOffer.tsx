// "Plan it in your AI chat" (S9 follow-up): with no AI key on this device but the connector on, Plan the day and the Sunday review banner
// also offer to do it in the person's AI chat app, which reads and edits the list through the connector. No AI call is made from the app,
// and no app is named or linked: the button copies a short sentence, to say in a new chat in whichever app is connected.
import { toast } from './store';
import { connector } from './sync';
import { aiOn } from '../ai/ask';
import { t } from '../i18n';

export type Offer = 'day' | 'review';
const PROMPT = { day: 'chatPlanPrompt', review: 'chatReviewPrompt' } as const;
const LABEL = { day: 'chatPlanBtn', review: 'chatReviewBtn' } as const;

/** The sentence to say in the chat, in the app's language. It names no vendor. */
export const chatPrompt = (what: Offer): string => t(PROMPT[what]);
/** The connector is on and there is no key to ask an AI from the app: the one case where the offer shows. */
export const offersChat = (): boolean => !aiOn.value && !!connector.value?.on;

export function ChatOffer({ what, testid, small = false }: { what: Offer; testid: string; small?: boolean }) {
  if (!offersChat()) return null;
  const copy = () => {
    const say = chatPrompt(what);
    navigator.clipboard?.writeText(say).then(() => toast(t('chatCopied', { say })), () => toast(t('chatCopied', { say })));
  };
  return <button class={'btn ghost' + (small ? ' small' : '')} type="button" onClick={copy} data-testid={testid}>{t(LABEL[what])}</button>;
}
