// Test helpers: a fresh space per test, and calls to the Worker's handler.
import { env, exports } from 'cloudflare:workers';
import { generateKey, deriveKeys, type SpaceKeys } from '../../src/sync/keys';
import { sealToText } from '../../src/sync/crypto';
import type { Env } from '../src/env';
import { handle } from '../src/index';

export const BASE = 'https://relay.test';
export const APP = 'https://app.example';

export const newSpace = async (): Promise<SpaceKeys> => deriveKeys(generateKey());
export const blobOf = (keys: SpaceKeys, v: unknown = { n: Math.random(), pad: 'x'.repeat(50) }) => sealToText(keys, v);

interface Call { auth?: string | false; body?: unknown; origin?: string; ip?: string; env?: Partial<Env> }

/** Call the Worker (through its default export, like a real request). */
export async function call(method: string, path: string, keys: SpaceKeys, o: Call = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (o.auth !== false) headers.Authorization = 'Bearer ' + (o.auth ?? keys.authSecret);
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.origin) headers.Origin = o.origin;
  headers['CF-Connecting-IP'] = o.ip ?? 'ip-' + Math.random().toString(36).slice(2);
  const req = new Request(BASE + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = o.env ? await handle(req, { ...(env as unknown as Env), ...o.env }) : await exports.default.fetch(req);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export const url = (keys: SpaceKeys, tail = '') => `/v1/spaces/${keys.spaceId}${tail}`;
export const push = (keys: SpaceKeys, device = 'dev1', o: Call = {}) => blobOf(keys).then(blob => call('POST', url(keys, '/batches'), keys, { body: { device, blob }, ...o }));
