// The wire types, shared by the app, the relay and the connector. See docs/dev/sync.md.
// The relay only ever sees the outer JSON below; the inner `ChangeBatch` and `Snapshot`
// are what gets encrypted into `blob`.
import type { Stored } from '../data/doc';
import type { Hlc } from '../data/hlc';
import type { Collection } from '../data/schema';

export type StoredDoc = Stored<Record<string, unknown>>;
/**
 * A document carrying only some fields: `_hlc` lists just the changed fields, and only those
 * fields are present. Same shape as a StoredDoc, so `merge()` takes it as is.
 */
export type PartialStoredDoc = StoredDoc;

// ---- Plaintext inside the blobs

export interface ChangeDoc { c: Collection; d: PartialStoredDoc }
export interface ChangeBatch {
  /** The schema version the sender writes. */
  v: number;
  /** The sender's clock node. */
  device: string;
  docs: ChangeDoc[];
}
export interface Snapshot {
  v: number;
  /** Covers every batch with seq <= upto. */
  upto: number;
  docs: Record<string, StoredDoc[]>;
  /**
   * A snapshot is whole (no `part`, as every one written before the split was) or two parts, hot
   * and cold (src/sync/parts.ts). Only the hot part carries the fields below.
   */
  part?: 'hot' | 'cold';
  /** hot: what the cold part it pairs with was cut from. */
  cut?: Cut;
  /** hot: the ids held only by the cold part, per collection, newline-separated. */
  cold?: Record<string, string>;
  /** hot: what the connector needs to know about the cold documents without reading them. */
  x?: ColdDigest;
  /** The newest clock in this part, so a reader need not scan for it. */
  top?: string;
}

/** Where hot and cold were cut: the day and the time, and the `upto` of the cold part written then. */
export interface Cut { day: string; wall: number; coldUpto: number }

/**
 * What the cold documents add to answers about the hot ones: points for the personal estimate
 * (steps done in the last ~400 days, as [id, est0, real, w0, doneDay, app, project, suit, by])
 * and how many steps each project has done, cold ones only.
 */
export interface ColdDigest {
  est: (string | number | null)[][];
  done: Record<string, number>;
}

// ---- Limits (DECISIONS.md). Sizes are of the encrypted blob before base64url.

export const MAX_BATCH_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
/** Length of the base64url text for n bytes. */
export const b64uLength = (n: number): number => Math.ceil((n * 4) / 3);
/** A page of changes stops after this many batches or about this many bytes of blobs. */
export const PAGE_BATCHES = 100;
export const PAGE_BYTES = 4 * 1024 * 1024;

// ---- Requests and responses of the relay (all JSON; blobs are base64url text)

/** POST /v1/spaces/:space/batches */
export interface PushRequest { device: string; blob: string }
export interface PushResponse { seq: number }

/** GET /v1/spaces/:space/changes?after=N */
export interface ChangesResponse {
  /** The latest seq in the space. `more` is true when this page stops before it. */
  head: number;
  more: boolean;
  /** Present when `after` < the snapshot's `upto`. With a two-part snapshot this is the hot part. */
  snapshot: { upto: number; blob: string; at: number } | null;
  /** The cold part, present when `after` is below its `upto`. Absent from answers to apps that predate it. */
  cold?: { upto: number; blob: string; at: number } | null;
  batches: { seq: number; device: string; blob: string; at: number }[];
}

/** PUT /v1/spaces/:space/snapshot */
export interface SnapshotRequest {
  upto: number;
  blob: string;
  /** 'hot': `blob` is the hot part of a two-part snapshot. Without it the snapshot is whole and replaces everything. */
  part?: 'hot';
  /** With 'hot': a new cold part, replacing the stored one. */
  cold?: { upto: number; blob: string };
  /** With 'hot' and no `cold`: the `upto` of the cold part this hot one pairs with; the stored cold must be at least that new (else 409 `bad_parts`). */
  coldUpto?: number;
}
export interface SnapshotResponse { upto: number; pruned: number }

/** POST /v1/spaces/:space/devices/:device — `label` is an encrypted `{ name }`. */
export interface DeviceRequest { label?: string }
export interface DevicesResponse { devices: { device: string; label: string | null; lastSeen: number }[] }

// ---- The connector (docs/dev/connector.md). The app switches it on and off; Bearer auth as for sync.

/** POST /v1/spaces/:space/connector — the space's raw encryption key, base64url (32 bytes). */
export interface ConnectorOnRequest { key: string }
/** The pairing code is shown once: 8 characters from an alphabet without look-alikes, as `ABCD-EFGH`. */
export interface ConnectorOnResponse {
  on: true;
  code: string;
  /** ms epoch; the code is single use and lasts 10 minutes. */
  expires: number;
  /** The address to add in the AI app (Claude: Settings, Connectors, Add custom connector). */
  url: string;
}
/** POST /v1/spaces/:space/connector/code — a fresh code, if the connector is on. */
export type ConnectorCodeResponse = Pick<ConnectorOnResponse, 'code' | 'expires'>;
/** GET /v1/spaces/:space/connector */
export interface ConnectorStatus { on: boolean; lastUsed: number | null; url: string }
/** DELETE /v1/spaces/:space/connector */
export interface ConnectorOffResponse { ok: true; revoked: number }

// ---- The inbox (docs/CHANGESET.md, "The one-tap link"). Sealed boxes for the owner; only ciphertext reaches the relay.

/** A sealed change-set is at most this many bytes (before base64url). */
export const MAX_INBOX_BYTES = 16 * 1024;
/** Unread items per space; more are refused until some are read. */
export const MAX_INBOX_ITEMS = 50;
/** Items are kept this long. */
export const INBOX_KEEP_MS = 30 * 86_400_000;
/** POST /v1/spaces/:space/inbox — no Authorization: the drop page has no secret. */
export interface InboxPostRequest { blob: string }
export interface InboxPostResponse { id: string }
/** GET /v1/spaces/:space/inbox (Bearer) */
export interface InboxListResponse { items: { id: string; blob: string; at: number }[] }
/** DELETE /v1/spaces/:space/inbox/:id (Bearer) */
export interface InboxDeleteResponse { ok: true; deleted: number }
export const INBOX_ID = /^[A-Za-z0-9_-]{16,32}$/;

export interface ErrorBody { error: ErrorCode }
export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'unknown_space' | 'too_large' | 'rate_limited' | 'bad_upto' | 'origin_not_allowed' | 'not_found'
  | 'connector_off' | 'wrong_key' | 'connector_unavailable' | 'bad_parts';

export const SPACE_ID = /^[A-Za-z0-9_-]{22}$/; // 16 bytes in base64url
export const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
