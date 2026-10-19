// The /authorize page: the one place a person signs an AI app in. A small server-rendered page
// (no scripts, no external fonts or images, inline CSS, fine at 320 px, light and dark, English or
// French from Accept-Language) that asks for the pairing code and nothing else, and says in one
// line what is granted. A valid code completes the authorization with the props {spaceId}.
//
// The OAuth library's consent helpers carry the request between the page and the form (a handle
// plus a cookie bound to this browser), so the form can't be forged or replayed.
import { AuthorizationError, CimdFetchError, type AuthRequest, type ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env';
import { clientIp, countIp, countKey, pairAllLimit, pairIpLimit } from '../limits';
import { spaceSlot } from '../sync';
import { oauthApi } from './oauth';
import { codeSpace, consumeCode } from './pairing';

type Lang = 'en' | 'fr';
const TEXT = {
  en: {
    title: 'Connect to Réussite',
    lead: (c: string) => `${c} will be able to <strong>read and edit this list</strong>.`,
    sendsTo: (h: string) => `You will be sent back to ${h}.`,
    local: 'This sends access to an app on this computer. Continue only if you just started signing in from it.',
    unverified: 'This app registered itself; its name is not verified.',
    code: 'Pairing code',
    hint: 'In Réussite, open Settings, then Connector, and switch it on. It shows a code for ten minutes.',
    connect: 'Connect',
    cancel: 'Cancel',
    wrong: 'That code is wrong or has expired. Check it in Réussite, or switch the connector off and on for a new one.',
    tooMany: 'Too many tries. Wait a minute, then try again.',
    expired: 'This sign-in page has expired. Start again from your AI app.',
    off: 'The connector was switched off. Switch it on again in Réussite.',
  },
  fr: {
    title: 'Connecter Réussite',
    lead: (c: string) => `${c} pourra <strong>lire et modifier cette liste</strong>.`,
    sendsTo: (h: string) => `Vous serez renvoyé vers ${h}.`,
    local: 'Cela donne l’accès à une application de cet ordinateur. Continuez seulement si vous venez de lancer la connexion depuis celle-ci.',
    unverified: 'Cette application s’est déclarée elle-même ; son nom n’est pas vérifié.',
    code: 'Code d’appairage',
    hint: 'Dans Réussite, ouvrez Réglages, puis Connecteur, et activez-le. Un code s’affiche pendant dix minutes.',
    connect: 'Connecter',
    cancel: 'Annuler',
    wrong: 'Ce code est incorrect ou a expiré. Vérifiez-le dans Réussite, ou désactivez puis réactivez le connecteur pour en obtenir un nouveau.',
    tooMany: 'Trop d’essais. Attendez une minute, puis réessayez.',
    expired: 'Cette page de connexion a expiré. Recommencez depuis votre application d’IA.',
    off: 'Le connecteur a été désactivé. Réactivez-le dans Réussite.',
  },
} as const;

/** French if it ranks above English in Accept-Language; English otherwise. */
export function pickLang(header: string | null): Lang {
  let best: Lang = 'en', q = 0;
  for (const part of (header ?? '').split(',')) {
    const [tag, ...params] = part.trim().toLowerCase().split(';');
    const lang = tag?.slice(0, 2);
    if (lang !== 'fr' && lang !== 'en') continue;
    const w = Number(params.find(p => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
    if (w > q) { q = w; best = lang; }
  }
  return best;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const CSS = `
:root{color-scheme:light dark;--bg:#f2f1f6;--card:#fff;--ink:#1d1b26;--soft:#5d5a6b;--line:#cfcbe0;--accent:#5b3e96;--on:#fff;--bad:#a1263a}
@media(prefers-color-scheme:dark){:root{--bg:#15131c;--card:#201d2b;--ink:#f1eff7;--soft:#b6b1c8;--line:#3a3550;--accent:#b79cf0;--on:#15131c;--bad:#ff8a9b}}
*{box-sizing:border-box;min-width:0}
body{margin:0;background:var(--bg);color:var(--ink);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 16px}
h1{font-size:1.4rem;line-height:1.25;margin:0 0 12px}
p{margin:0 0 12px;overflow-wrap:anywhere}
.soft{color:var(--soft);font-size:.9rem}
label{display:block;font-weight:600;margin:16px 0 4px}
input{width:100%;min-height:48px;padding:8px 12px;font:inherit;font-size:1.25rem;letter-spacing:.12em;text-transform:uppercase;border:2px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink)}
input:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.err{color:var(--bad);font-weight:600;margin:12px 0 0}
.row{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}
button{flex:1 1 8rem;min-height:48px;padding:8px 16px;font:inherit;font-weight:600;border-radius:12px;border:2px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer}
button.primary{background:var(--accent);color:var(--on)}
.warn{border-left:4px solid var(--bad);padding-left:12px}
`;

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

function page(lang: Lang, body: string, status = 200, extra?: Headers): Response {
  const t = TEXT[lang];
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${esc(t.title)}</title><style>${CSS}</style></head><body><main><div class="card">${body}</div></main></body></html>`;
  const headers = new Headers(extra);
  for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v);
  // Nothing may load; the form posts back to this page. (No form-action: Chrome applies it to the redirect that follows.)
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(html, { status, headers });
}

function form(lang: Lang, d: ConsentDescription, handle: string, error?: string): string {
  const t = TEXT[lang];
  return `<h1>${esc(t.title)}</h1>
<p>${t.lead(`<strong>${esc(d.clientName)}</strong>`)}</p>
<p class="soft">${d.clientDomain ? esc(d.clientDomain) + ' · ' : ''}${esc(t.sendsTo(d.redirectHost))}${d.clientDomain ? '' : ' ' + esc(t.unverified)}</p>
${d.redirectIsLoopback ? `<p class="warn">${esc(t.local)}</p>` : ''}
<form method="post" autocomplete="off">
<input type="hidden" name="handle" value="${esc(handle)}">
<label for="code">${esc(t.code)}</label>
<p class="soft">${esc(t.hint)}</p>
<input id="code" name="code" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="12" required placeholder="ABCD-EFGH" aria-describedby="${error ? 'err' : 'none'}">
${error ? `<p id="err" class="err" role="alert">${esc(error)}</p>` : ''}
<div class="row"><button class="primary" type="submit" name="decision" value="approve">${esc(t.connect)}</button><button type="submit" name="decision" value="deny" formnovalidate>${esc(t.cancel)}</button></div>
</form>`;
}

/** The consent form for a validated request: describes the app, opens a consent transaction. */
async function showForm(env: Env, lang: Lang, authRequest: AuthRequest, error?: string, status = 200): Promise<Response> {
  const oauth = oauthApi(env);
  const d = await oauth.describeConsent(authRequest); // first: a failed lookup leaves nothing in KV
  const consent = await oauth.beginConsent(authRequest);
  return page(lang, form(lang, d, consent.handle, error), status, consent.headers);
}

const plain = (lang: Lang, message: string, status = 400) => page(lang, `<h1>${esc(TEXT[lang].title)}</h1><p>${esc(message)}</p>`, status);

export async function handleAuthorize(req: Request, env: Env): Promise<Response> {
  const lang = pickLang(req.headers.get('Accept-Language'));
  const t = TEXT[lang];
  const oauth = oauthApi(env);
  try {
    if (req.method === 'GET') return await showForm(env, lang, await oauth.parseAuthRequest(req));
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });

    const data = await req.formData();
    const handle = String(data.get('handle') ?? '');
    if (data.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(req, handle); // back to the app: access_denied
      return new Response(null, { status: 302, headers: denied.headers });
    }

    // Guessing costs: per IP, and overall (a code doesn't say which space it belongs to).
    const now = Date.now();
    const ip = clientIp(req);
    const okIp = await countKey(env, 'pair-ip:' + ip, now, pairIpLimit(env));
    const okAll = await countKey(env, 'pair-all', now, pairAllLimit(env));
    if (!okIp || !okAll) return plain(lang, t.tooMany, 429);

    const found = await codeSpace(env, String(data.get('code') ?? ''), now);
    if (!found) {
      await countIp(env, ip, now); // failed sign-ins also draw on the IP's general budget
      return await showForm(env, lang, await oauth.parseAuthRequest(req), t.wrong, 400);
    }
    const approved = await oauth.approveConsent(req, handle);
    if (!(await consumeCode(env, found.hash, now))) return plain(lang, t.wrong); // used by someone else a moment ago
    if (!(await env.DB.prepare('SELECT 1 AS x FROM connector WHERE space = ?1').bind(found.space).first())) return plain(lang, t.off);
    if ((await spaceSlot(env, found.space, now, 0)) === null) return plain(lang, t.tooMany, 429); // per-space limit

    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request, userId: found.space, metadata: { label: 'connector' }, scope: approved.request.scope, props: { spaceId: found.space },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return plain(lang, e.code === 'invalid_request' ? t.expired : e.description || t.expired);
    if (e instanceof CimdFetchError) return plain(lang, t.expired);
    throw e;
  }
}
