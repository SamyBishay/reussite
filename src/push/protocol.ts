// The wire types and limits of the push endpoints, shared by the app and the relay
// (docs/dev/push.md). The relay never sees a notification's text: `blob` is an RFC 8291
// aes128gcm payload (src/push/encrypt.ts), base64url, that the push service delivers to the
// device as is.

// ---- Ids and limits

/** 16 random bytes in base64url: the device's push id. Chosen by the device, unrelated to any space. */
export const PUSH_ID = /^[A-Za-z0-9_-]{22}$/;
/** An item id is made by the app's schedule builder (`fixed:<rootId>:<day>`, `launch:<day>:<n>`, ...). */
export const PUSH_ITEM_ID = /^[A-Za-z0-9_:.-]{1,96}$/;
/** The bearer secret: 32 random bytes in base64url (the relay stores only its SHA-256). */
export const PUSH_SECRET = /^[A-Za-z0-9_-]{20,64}$/;

/** The longest endpoint URL kept (real ones are 150 to 300 characters). */
export const MAX_ENDPOINT_CHARS = 512;
/** Items the relay holds per device: the app's rolling window. */
export const MAX_PUSH_ITEMS = 150;
/** A schedule request, in characters of JSON. */
export const MAX_SCHEDULE_CHARS = 512 * 1024;
/** `at` of an item must be within this of the relay's clock. */
export const PUSH_AT_SPAN_MS = 31 * 86_400_000;
/** An item's `ttl`, in seconds: how long after `at` the push service may still deliver it. */
export const MIN_PUSH_TTL = 60;
export const MAX_PUSH_TTL = 86_400;
/** The padded plaintext of the record is a multiple of this many bytes (RFC 8291, section 4). */
export const PAD_BLOCK = 256;
/** The biggest plaintext (title, body, tag and url as JSON) the app may encrypt: three blocks, less the delimiter byte. */
export const MAX_PUSH_PLAINTEXT = 3 * PAD_BLOCK - 1;
/** A blob is at most 86 + 768 + 16 bytes; this is its base64url length with room to spare. */
export const MAX_PUSH_BLOB_CHARS = 1400;

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';
export const PUSH_URGENCIES: readonly PushUrgency[] = ['very-low', 'low', 'normal', 'high'];

// ---- Requests and responses (JSON). Bearer: the push secret.

/** PUT /v1/push/:pid — registers or updates the device. The first write sets the secret's hash. */
export interface PushRegisterRequest { endpoint: string }
export interface PushOk { ok: true }

/** One notification due at `at`. `blob` is the encrypted payload. */
export interface PushItem {
  id: string;
  /** ms epoch. */
  at: number;
  /** Seconds after `at` during which it may still be sent and delivered. */
  ttl: number;
  /** Default 'high': a reminder is worth waking the phone for. */
  urgency?: PushUrgency;
  blob: string;
}

/**
 * PUT /v1/push/:pid/schedule — atomic replace. The device's items afterwards are exactly
 * `items` (added or overwritten by id) plus those already held whose id is in `keep`;
 * anything else is deleted. An id in `keep` that the relay does not hold is ignored.
 */
export interface PushScheduleRequest { items: PushItem[]; keep: string[] }
export interface PushScheduleResponse {
  /** Items written. */
  stored: number;
  /** Items held afterwards. */
  held: number;
}

/** POST /v1/push/:pid/send — one push now (the "Send a test" button). */
export interface PushSendRequest { blob: string }
/** `status` is the push service's answer (201 when it took the push). */
export interface PushSendResponse { ok: true; status: number }

/** DELETE /v1/push/:pid — the device and its items. */
export interface PushDeleteResponse { ok: true; deleted: number }

export type PushErrorCode =
  | 'bad_endpoint' // the endpoint's host is not a known push service
  | 'unknown_device' // no such pid (schedule, send)
  | 'gone' // the push service said the subscription no longer exists; the device was dropped, so subscribe again
  | 'push_failed' // the push service refused or could not be reached
  | 'push_unavailable'; // the relay has no VAPID keys

/** The path of a device's endpoints. */
export const pushPath = (pid: string, tail: '' | 'schedule' | 'send' = ''): string => `/v1/push/${pid}${tail ? '/' + tail : ''}`;
