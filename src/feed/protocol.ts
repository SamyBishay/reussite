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
