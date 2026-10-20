// Sending one Web Push message: the endpoint check (so the relay cannot be aimed at an internal
// address), the VAPID signer, and the POST. The payload arrives already encrypted by the device
// (RFC 8291); the relay only forwards the bytes. docs/dev/push.md.
import { b64uDecode } from '../../src/sync/bytes';
import { MAX_ENDPOINT_CHARS, type PushUrgency } from '../../src/push/protocol';
import { audienceOf, importVapidPrivate, signVapid, vapidHeader } from '../../src/push/vapid';
import type { Env } from './env';

/** Hosts that may be plain http, and only with an explicit port in PUSH_HOSTS: the local tests' push stub. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

interface HostRule { host: string; wildcard: boolean; port: string | null }
const rules = new Map<string, HostRule[]>();

function parseRules(list: string): HostRule[] {
  let r = rules.get(list);
  if (!r) {
    r = list.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).map(s => {
      const i = s.lastIndexOf(':');
      const host = i < 0 ? s : s.slice(0, i);
      return { host: host.replace(/^\*\./, ''), wildcard: host.startsWith('*.'), port: i < 0 ? null : s.slice(i + 1) };
    });
    rules.set(list, r);
  }
  return r;
}

/**
 * The endpoint as a URL if its host is one of PUSH_HOSTS, else null. https only (http only for
 * localhost with an explicit port); no credentials in the URL; the host as the URL parser reads
 * it (the one `fetch` will use) must equal an entry or end with `.suffix` of a wildcard entry.
 * An IP address never matches unless an entry spells it, which only the local tests do.
 */
export function checkEndpoint(endpoint: unknown, env: Pick<Env, 'PUSH_HOSTS'>): URL | null {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_CHARS) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.username || url.password) return null;
  const secure = url.protocol === 'https:';
  if (!secure && url.protocol !== 'http:') return null;
  const ok = parseRules(env.PUSH_HOSTS ?? '').some(r => {
    const hostOk = r.wildcard ? url.hostname.length > r.host.length + 1 && url.hostname.endsWith('.' + r.host) : url.hostname === r.host;
    const portOk = r.port === '*' || (r.port ?? '') === url.port;
    const schemeOk = secure || (r.port !== null && LOCAL_HOSTS.has(url.hostname));
    return hostOk && portOk && schemeOk;
  });
  return ok ? url : null;
}

export interface Signer { key: CryptoKey; publicKey: string; subject: string }

/** The relay's VAPID signing key, or null when the keys are not set (or malformed): nothing can be sent. */
export async function loadSigner(env: Env): Promise<Signer | null> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return null;
  try {
    return { key: await importVapidPrivate({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }), publicKey: env.VAPID_PUBLIC_KEY, subject: env.VAPID_SUBJECT };
  } catch {
    return null;
  }
}

/** Authorization headers, one signature per push-service audience for as long as this object lives (one tick). */
export class VapidHeaders {
  private byAudience = new Map<string, Promise<string>>();
  signed = 0;
  constructor(private signer: Signer, private now: number) {}
  for(endpoint: URL | string): Promise<string> {
    const aud = audienceOf(typeof endpoint === 'string' ? endpoint : endpoint.href);
    let h = this.byAudience.get(aud);
    if (!h) {
      this.signed++;
      h = signVapid(this.signer.key, aud, this.signer.subject, this.now).then(jwt => vapidHeader(jwt, this.signer.publicKey));
      this.byAudience.set(aud, h);
    }
    return h;
  }
}

export interface Outgoing {
  endpoint: URL | string;
  /** base64url aes128gcm payload. */
  blob: string;
  /** Seconds the push service may hold it. */
  ttl: number;
  urgency: PushUrgency;
  authorization: string;
}

/** POST one message. Returns the push service's HTTP status, or 0 if it could not be reached. Redirects are never followed. */
export async function sendWebPush(doFetch: typeof fetch, m: Outgoing): Promise<number> {
  try {
    const res = await doFetch(typeof m.endpoint === 'string' ? m.endpoint : m.endpoint.href, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(Math.max(0, Math.floor(m.ttl))), Urgency: m.urgency, Authorization: m.authorization },
      body: b64uDecode(m.blob),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}
