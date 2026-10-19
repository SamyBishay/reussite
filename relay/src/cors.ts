// CORS: the app (Pages, production and previews) is a different origin from the relay.
import type { Env } from './env';

const cache = new Map<string, RegExp[]>();

/** `https://*.x.pages.dev` and `http://localhost:*`: each `*` is one DNS label or one port, never a dot. */
function patterns(list: string): RegExp[] {
  let p = cache.get(list);
  if (!p) {
    p = list.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[A-Za-z0-9-]+') + '$'));
    cache.set(list, p);
  }
  return p;
}

export const originAllowed = (origin: string, env: Env): boolean => patterns(env.ALLOWED_ORIGINS ?? '').some(r => r.test(origin));

export const corsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
