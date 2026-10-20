// Turning the wanted schedule into the smallest upload. The wanted list (`buildSchedule`) is
// compared with what this device last sent: an item whose text, time and key are unchanged is not
// encrypted or uploaded again, only named in `keep`; one that is gone from the list simply isn't
// named, and the relay deletes it. A hash stands for the plaintext because the ciphertext is
// different every time. The subscription's auth secret goes into the hash, so a new subscription
// invalidates everything at once.
import type { ScheduleItem } from '../domain/notify';
import { b64uEncode, utf8 } from '../sync/bytes';
import { encryptPushBlob, type SubscriptionKeys } from './encrypt';
import { payloadJson, payloadOf } from './notification';
import { MAX_PUSH_ITEMS, type PushItem } from './protocol';

/** Item id → [hash of what was sent, when it is due]. Kept in `local` as `push.sent`. */
export type Sent = Record<string, [hash: string, at: number]>;

/** The relay sends an item up to this long before its time (docs/dev/push.md: `at <= now + 5 s`). */
export const SEND_AHEAD_MS = 5000;

export async function hashItem(auth: string, item: Pick<ScheduleItem, 'id' | 'at' | 'ttl'>, json: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', utf8(JSON.stringify([auth, item.id, item.at, item.ttl, json])));
  return b64uEncode(new Uint8Array(d).subarray(0, 12));
}

export interface UploadPlan {
  items: PushItem[];
  keep: string[];
  /** What `sent` becomes once the upload is accepted. */
  next: Sent;
  /** Items still waiting on the relay that are no longer wanted. */
  removed: number;
  /** Anything to upload at all: something new or changed, or something to take away. */
  dirty: boolean;
}

/**
 * `wanted` is sorted soonest first and is cut to the relay's limit here as well (it is already
 * capped by the builder; a belt for the braces). Only changed items are encrypted.
 */
export async function planUpload(wanted: readonly ScheduleItem[], sub: SubscriptionKeys, sent: Sent, now: number, encrypt = encryptPushBlob): Promise<UploadPlan> {
  const items: PushItem[] = [];
  const keep: string[] = [];
  const next: Sent = {};
  for (const w of wanted.slice(0, MAX_PUSH_ITEMS)) {
    if (next[w.id]) continue;
    const json = payloadJson(payloadOf(w));
    const hash = await hashItem(sub.auth, w, json);
    next[w.id] = [hash, w.at];
    if (sent[w.id]?.[0] === hash) { keep.push(w.id); continue; }
    items.push({ id: w.id, at: w.at, ttl: w.ttl, blob: await encrypt(sub, json) });
  }
  // An old entry whose time has passed was sent (and deleted) by the relay: nothing to take away.
  const removed = Object.entries(sent).filter(([id, [, at]]) => !next[id] && at > now + SEND_AHEAD_MS).length;
  return { items, keep, next, removed, dirty: items.length > 0 || removed > 0 };
}

/** The cache as stored, or an empty one if it isn't what we wrote. */
export function readSent(v: unknown): Sent {
  const out: Sent = {};
  if (!v || typeof v !== 'object') return out;
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number') out[id] = [e[0], e[1]];
  }
  return out;
}
