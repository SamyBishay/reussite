// A thin client for the relay's sync endpoints: encrypts on the way out, decrypts on the way in.
// `fetch` is injectable (tests, the connector). Errors from the relay become `RelayError`.
import {
  b64uLength, MAX_BATCH_BYTES, MAX_INBOX_BYTES, MAX_SNAPSHOT_BYTES, SPACE_ID,
  type ChangeBatch, type ChangesResponse, type ConnectorCodeResponse, type ConnectorOffResponse, type ConnectorOnRequest, type ConnectorOnResponse, type ConnectorStatus,
  type DeviceRequest, type DevicesResponse, type ErrorCode, type InboxListResponse, type InboxPostRequest, type InboxPostResponse, type PushRequest, type PushResponse,
  type Snapshot, type SnapshotRequest, type SnapshotResponse,
} from './protocol';
import { openFromText, sealToText } from './crypto';
import { b64uEncode } from './bytes';
import type { SpaceKeys } from './keys';

export class RelayError extends Error {
  constructor(public status: number, public code: ErrorCode | 'network') { super(`relay ${status} ${code}`); }
}

export interface Pulled {
  head: number;
  more: boolean;
  snapshot: Snapshot | null;
  batches: { seq: number; at: number; batch: ChangeBatch }[];
}

export class RelayClient {
  private base: string;
  constructor(baseUrl: string, private keys: Pick<SpaceKeys, 'spaceId' | 'authSecret' | 'encKey'> & Partial<Pick<SpaceKeys, 'encKeyRaw'>>, private fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = baseUrl.replace(/\/+$/, '') + '/v1/spaces/' + keys.spaceId;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { Authorization: 'Bearer ' + this.keys.authSecret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new RelayError(0, 'network');
    }
    if (!res.ok) {
      const e = (await res.json().catch(() => null)) as { error?: ErrorCode } | null;
      throw new RelayError(res.status, e?.error ?? 'bad_request');
    }
    return (await res.json()) as T;
  }

  /** Encrypt and append a batch; returns its seq. Throws RelayError('too_large') before sending if over the cap. */
  async push(batch: ChangeBatch): Promise<number> {
    const blob = await sealToText(this.keys, batch);
    if (blob.length > b64uLength(MAX_BATCH_BYTES)) throw new RelayError(413, 'too_large');
    const body: PushRequest = { device: batch.device, blob };
    return (await this.call<PushResponse>('POST', '/batches', body)).seq;
  }

  /** One page of changes after `after`, decrypted. Throws DecryptError if the key is wrong. */
  async pull(after: number): Promise<Pulled> {
    const r = await this.call<ChangesResponse>('GET', '/changes?after=' + after);
    return {
      head: r.head,
      more: r.more,
      snapshot: r.snapshot ? await openFromText<Snapshot>(this.keys, r.snapshot.blob) : null,
      batches: await Promise.all(r.batches.map(async b => ({ seq: b.seq, at: b.at, batch: await openFromText<ChangeBatch>(this.keys, b.blob) }))),
    };
  }

  /** Store a snapshot; the relay drops the batches it covers. */
  async putSnapshot(snapshot: Snapshot): Promise<SnapshotResponse> {
    const blob = await sealToText(this.keys, snapshot);
    if (blob.length > b64uLength(MAX_SNAPSHOT_BYTES)) throw new RelayError(413, 'too_large');
    const body: SnapshotRequest = { upto: snapshot.upto, blob };
    return this.call<SnapshotResponse>('PUT', '/snapshot', body);
  }

  /** Record that this device was seen, with an optional name (encrypted). */
  async touchDevice(device: string, name?: string): Promise<void> {
    const body: DeviceRequest = name === undefined ? {} : { label: await sealToText(this.keys, { name }) };
    await this.call('POST', '/devices/' + device, body);
  }

  async devices(): Promise<{ device: string; name: string | null; lastSeen: number }[]> {
    const r = await this.call<DevicesResponse>('GET', '/devices');
    return Promise.all(r.devices.map(async d => ({
      device: d.device,
      lastSeen: d.lastSeen,
      name: d.label ? (await openFromText<{ name: string }>(this.keys, d.label).catch(() => null))?.name ?? null : null,
    })));
  }

  // ---- The connector (docs/dev/connector.md)

  /** Switch it on: hands the relay the space's key. The pairing code is shown once. Throws RelayError('wrong_key' | 'connector_unavailable'). */
  async connectorOn(): Promise<ConnectorOnResponse> {
    if (!this.keys.encKeyRaw) throw new Error('the raw key is needed to switch the connector on');
    const body: ConnectorOnRequest = { key: b64uEncode(this.keys.encKeyRaw) };
    return this.call<ConnectorOnResponse>('POST', '/connector', body);
  }
  /** A fresh pairing code. Throws RelayError('connector_off') when it isn't on. */
  connectorCode(): Promise<ConnectorCodeResponse> {
    return this.call<ConnectorCodeResponse>('POST', '/connector/code');
  }
  connectorStatus(): Promise<ConnectorStatus> {
    return this.call<ConnectorStatus>('GET', '/connector');
  }
  /** Switch it off: the relay deletes the key and signs every AI app out. */
  connectorOff(): Promise<ConnectorOffResponse> {
    return this.call<ConnectorOffResponse>('DELETE', '/connector');
  }

  // ---- The inbox: items are sealed to the inbox public key (src/sync/inbox.ts); the relay never opens them.

  async inbox(): Promise<InboxListResponse['items']> {
    return (await this.call<InboxListResponse>('GET', '/inbox')).items;
  }
  async deleteInboxItem(id: string): Promise<void> {
    await this.call('DELETE', '/inbox/' + encodeURIComponent(id));
  }

  /** "Delete everywhere": removes the space from the relay. */
  async deleteSpace(): Promise<void> {
    await this.call('DELETE', '');
  }
}

/**
 * Leave a sealed change-set in a space's inbox. Needs no secret: this is what the drop page does,
 * on a browser that holds nothing. Throws RelayError ('unknown_space', 'rate_limited', 'too_large', 'network'…).
 */
export async function postToInbox(baseUrl: string, space: string, blob: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<string> {
  if (!SPACE_ID.test(space)) throw new RelayError(400, 'bad_request');
  if (blob.length > b64uLength(MAX_INBOX_BYTES)) throw new RelayError(413, 'too_large');
  let res: Response;
  try {
    res = await fetchFn(baseUrl.replace(/\/+$/, '') + '/v1/spaces/' + space + '/inbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blob } satisfies InboxPostRequest),
    });
  } catch {
    throw new RelayError(0, 'network');
  }
  const out = (await res.json().catch(() => null)) as (Partial<InboxPostResponse> & { error?: ErrorCode }) | null;
  if (!res.ok || !out?.id) throw new RelayError(res.status, out?.error ?? 'bad_request');
  return out.id;
}
