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
  /** Present when `after` < the snapshot's `upto`. */
  snapshot: { upto: number; blob: string; at: number } | null;
  batches: { seq: number; device: string; blob: string; at: number }[];
}

/** PUT /v1/spaces/:space/snapshot */
export interface SnapshotRequest { upto: number; blob: string }
export interface SnapshotResponse { upto: number; pruned: number }

/** POST /v1/spaces/:space/devices/:device — `label` is an encrypted `{ name }`. */
export interface DeviceRequest { label?: string }
export interface DevicesResponse { devices: { device: string; label: string | null; lastSeen: number }[] }

export interface ErrorBody { error: ErrorCode }
export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'unknown_space' | 'too_large' | 'rate_limited' | 'bad_upto' | 'origin_not_allowed' | 'not_found';

export const SPACE_ID = /^[A-Za-z0-9_-]{22}$/; // 16 bytes in base64url
export const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
