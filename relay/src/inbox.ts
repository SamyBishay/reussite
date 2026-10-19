// The inbox (docs/CHANGESET.md, "The one-tap link"): the drop page leaves a change-set, sealed to
// the person's inbox public key, and their app picks it up at its next sync. The relay never
// decrypts it. Adding needs no secret (the drop page on an iPhone has none), so it is small,
// capped in number, rate-limited per IP and per space, and only for spaces that exist. Reading
// and deleting need the space's Bearer secret, as everything else.
import { b64uEncode, isB64u } from '../../src/sync/bytes';
import {
  b64uLength, INBOX_ID, INBOX_KEEP_MS, MAX_INBOX_BYTES, MAX_INBOX_ITEMS, SPACE_ID,
  type InboxDeleteResponse, type InboxListResponse, type InboxPostResponse,
} from '../../src/sync/protocol';
import type { Env } from './env';
import { fail, json, readJson } from './http';
import { clientIp, countKey, inboxIpLimit, inboxSpaceLimit } from './limits';
import { authorize, ipGate, limited } from './sync';

export async function handleInbox(req: Request, env: Env, space: string, id?: string): Promise<Response> {
  if (!SPACE_ID.test(space)) return fail('bad_request', 400);
  if (id === undefined && req.method === 'POST') return post(req, env, space);
  if (id === undefined && req.method === 'GET') return list(req, env, space);
  if (id !== undefined && req.method === 'DELETE') return remove(req, env, space, id);
  return fail('not_found', 404);
}

async function post(req: Request, env: Env, space: string): Promise<Response> {
  const max = b64uLength(MAX_INBOX_BYTES);
  const body = await readJson(req, max + 100);
  if (body === 'too_large') return fail('too_large', 413);
  const blob = body?.blob;
  if (typeof blob !== 'string' || blob.length < 40 || !isB64u(blob)) return fail('bad_request', 400);
  if (blob.length > max) return fail('too_large', 413);

  const now = Date.now();
  if (!(await countKey(env, 'inbox-ip:' + clientIp(req), now, inboxIpLimit(env)))) return limited();
  // Only for spaces that exist, checked before counting the space so a made-up id costs no row.
  if (!(await env.DB.prepare('SELECT 1 AS x FROM spaces WHERE id = ?1').bind(space).first())) return fail('unknown_space', 404);
  if (!(await countKey(env, 'inbox-space:' + space, now, inboxSpaceLimit(env)))) return limited();

  const keep = now - INBOX_KEEP_MS;
  await env.DB.prepare('DELETE FROM inbox WHERE space = ?1 AND at < ?2').bind(space, keep).run();
  const id = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
  const r = await env.DB.prepare(
    'INSERT INTO inbox (id, space, blob, at) SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM inbox WHERE space = ?2) < ?5',
  ).bind(id, space, blob, now, MAX_INBOX_ITEMS).run();
  if (!r.meta.changes) return limited();
  return json({ id } satisfies InboxPostResponse, 201);
}

async function list(req: Request, env: Env, space: string): Promise<Response> {
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  const rows = await env.DB.prepare('SELECT id, blob, at FROM inbox WHERE space = ?1 AND at >= ?2 ORDER BY at, id LIMIT ?3')
    .bind(space, Date.now() - INBOX_KEEP_MS, MAX_INBOX_ITEMS).all<InboxListResponse['items'][number]>();
  return json({ items: rows.results } satisfies InboxListResponse);
}

async function remove(req: Request, env: Env, space: string, id: string): Promise<Response> {
  if (!INBOX_ID.test(id)) return fail('bad_request', 400);
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  const r = await env.DB.prepare('DELETE FROM inbox WHERE space = ?1 AND id = ?2').bind(space, id).run();
  return json({ ok: true, deleted: r.meta.changes } satisfies InboxDeleteResponse);
}
