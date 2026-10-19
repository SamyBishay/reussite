// Rate limiting that fits the free plan. Per space: the counter lives on the space's own row
// and is bumped in the same statement as the write, so it costs no extra row. Per IP: one small
// D1 row per minute, counted only for writes and failed sign-ins (reads are not counted).
import type { Env } from './env';

const MINUTE = 60_000;
export const spaceLimit = (env: Env) => Number(env.RATE_SPACE_PER_MIN) || 60;
export const ipLimit = (env: Env) => Number(env.RATE_IP_PER_MIN) || 120;
export const pairIpLimit = (env: Env) => Number(env.RATE_PAIR_IP_PER_MIN) || 10;
export const pairAllLimit = (env: Env) => Number(env.RATE_PAIR_ALL_PER_MIN) || 60;

export const clientIp = (req: Request): string => req.headers.get('CF-Connecting-IP') ?? 'local';

/** Count one event under `key` for this minute; false once it is over `limit`. */
export async function countKey(env: Env, key: string, now: number, limit: number): Promise<boolean> {
  const win = Math.floor(now / MINUTE);
  const row = await env.DB.prepare('INSERT INTO rate (key, win, n) VALUES (?1, ?2, 1) ON CONFLICT (key, win) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(key, win).first<{ n: number }>();
  if (row?.n === 1) await env.DB.prepare('DELETE FROM rate WHERE win < ?1').bind(win - 5).run(); // tidy up, once per new row
  return (row?.n ?? 1) <= limit;
}

/** Count one event for this IP; false once it is over the limit for the minute. */
export const countIp = (env: Env, ip: string, now: number): Promise<boolean> => countKey(env, 'ip:' + ip, now, ipLimit(env));
