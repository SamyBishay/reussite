// What a push says and how the service worker shows it. The app encrypts one JSON payload per
// scheduled item (`payloadOf`); the worker turns the decrypted JSON into `showNotification`
// arguments (`pushToNotification`). Both are pure so they are tested without a browser, and the
// worker file stays thin. Nothing here uses the DOM.
import { MAX_PUSH_PLAINTEXT } from './protocol';

/** The app's name: not translated, and the only title a notification has. */
export const APP_TITLE = 'Réussite';
/** Where a tap on a notification goes, relative to the worker's scope. */
export const OPEN_URL = './#today';

/** What is encrypted for one push, as JSON. */
export interface PushPayload { title: string; body: string; tag: string; url: string }

export function payloadOf(item: { id: string; text: string }): PushPayload {
  return { title: APP_TITLE, body: item.text, tag: item.id, url: OPEN_URL };
}

const encoder = new TextEncoder();

/** The payload as JSON, cut (on a character boundary, with an ellipsis) so that it fits in the 767 bytes a push may carry. */
export function payloadJson(p: PushPayload): string {
  let chars = [...p.body];
  let json = JSON.stringify(p);
  while (encoder.encode(json).length > MAX_PUSH_PLAINTEXT && chars.length > 1) {
    chars = chars.slice(0, Math.max(1, Math.floor(chars.length * 0.8)));
    json = JSON.stringify({ ...p, body: chars.join('') + '…' });
  }
  return json;
}

export interface NotificationSpec {
  title: string;
  options: { body: string; tag: string; icon: string; badge: string; data: { url: string } };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The notification to show for a decrypted payload. Always returns one (iOS revokes the right to
 * push for a worker that receives a push and shows nothing), so a payload that is missing,
 * malformed or the wrong shape still shows the app's name. `scope` is the worker's registration
 * scope, which the icon and the tap target are relative to.
 */
export function pushToNotification(raw: unknown, scope: string): NotificationSpec {
  let o: Record<string, unknown> = {};
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = { body: raw }; } }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) o = raw as Record<string, unknown>;
  const at = (path: string) => new URL(path, scope).href;
  // A tap target outside the app's scope is ignored: the payload is ours, but the check is one line.
  let url = at(str(o.url) || OPEN_URL);
  if (!url.startsWith(at('./'))) url = at(OPEN_URL);
  return {
    title: str(o.title) || APP_TITLE,
    options: { body: str(o.body), tag: str(o.tag), icon: at('icons/icon-192.png'), badge: at('icons/favicon-32.png'), data: { url } },
  };
}
