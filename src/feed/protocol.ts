// The wire details of the calendar feed, shared by the app and the relay (docs/dev/feed.md).
// The app uploads finished calendar text; the relay stores it and serves it, unauthenticated,
// at an address nobody can guess.

/** 24 random bytes (192 bits) in base64url: the feed's id, and the secret in its public address. */
export const FEED_ID = /^[A-Za-z0-9_-]{32}$/;
/** The write secret: 32 random bytes in base64url (the relay stores only its SHA-256). */
export const FEED_SECRET = /^[A-Za-z0-9_-]{20,64}$/;
/** The biggest calendar text kept, in bytes. */
export const MAX_FEED_BYTES = 256 * 1024;

export const feedPath = (fid: string) => `/v1/feed/${fid}`;
/** The address calendar apps subscribe to, on the relay at `base` (no trailing slash). */
export const feedUrl = (base: string, fid: string) => `${base}/cal/${fid}.ics`;
export const aliasPath = (fid: string) => `/v1/feed/${fid}/alias`;

/**
 * The one feed of a list (setting `feedShared`, synced and end-to-end encrypted like the rest): its id and
 * write secret, so every device writes the same feed, and the connector too while it is on. `app` is the
 * app's address (for the link that opens a step), `zone` the time zone of the device that made it (for
 * events whose place has none). `'off'`: the person switched the calendar off. `null`: never set
 * (feeds made before 27 Oct 2026 belonged to one device each; the first device to start a newer app shares its own).
 */
export interface SharedFeed { fid: string; secret: string; app?: string; zone?: string }
export type FeedShare = SharedFeed | 'off' | null;

/** The shared feed in a stored setting, or null when there is none or it is malformed. */
export function sharedFeed(v: unknown): SharedFeed | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.fid !== 'string' || !FEED_ID.test(o.fid) || typeof o.secret !== 'string' || !FEED_SECRET.test(o.secret)) return null;
  return { fid: o.fid, secret: o.secret, ...(typeof o.app === 'string' ? { app: o.app } : {}), ...(typeof o.zone === 'string' ? { zone: o.zone } : {}) };
}

/** A feed nobody wrote for this long is served with an event that says it is out of date (devices write one in use at least weekly). */
export const FEED_STALE_MS = 10 * 86_400_000;
