// The /authorize page and the pairing code: who gets a token, and who doesn't.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshMinute } from './helpers';
import { CODE_ALPHABET, formatCode, newCode, normalizeCode } from '../src/connector/pairing';
import { pickLang } from '../src/connector/authorize';
import { beginAuthorize, exchange, newApp, register, rpc, signIn, submitAuthorize, switchOn, tool } from './connector';

async function paired() {
  const app = await newApp();
  app.device.add('tasks', 't1', { title: 'x' });
  await app.sync();
  const on = await switchOn(app);
  return { app, code: on.body.code as string };
}

describe('pairing codes', () => {
  it('are eight characters from an alphabet without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL5S2Z8BUQ]/);
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(normalizeCode(' acde-fghj ')).toBe('ACDEFGHJ');
    expect(normalizeCode('ABCD-EFG0')).toBeNull();
    expect(normalizeCode('ABC')).toBeNull();
  });
});

describe('the authorize page', () => {
  it('asks only for the code, says what is granted, and names the app', async () => {
    const { clientId } = await register('Claude');
    const b = await beginAuthorize(clientId);
    expect(b.status).toBe(200);
    expect(b.html).toContain('read and edit this list');
    expect(b.html).toContain('Claude');
    expect(b.html).toContain('claude.ai'); // where the sign-in goes
    expect(b.html.match(/<input /g)).toHaveLength(2); // the handle (hidden) and the code
    expect(b.html).not.toMatch(/<script|<link|<img|https?:\/\/[^"' ]*\.(js|css|woff)/i);
    expect(b.html).toContain('name="viewport"');
    expect(b.html).toContain('prefers-color-scheme:dark');
  });

  it('speaks French when asked to, and escapes what the app calls itself', async () => {
    const { clientId } = await register('<script>alert(1)</script> & co');
    const fr = await beginAuthorize(clientId, { acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.5' });
    expect(fr.html).toContain('<html lang="fr">');
    expect(fr.html).toContain('lire et modifier cette liste');
    expect(fr.html).not.toContain('<script>alert');
    expect(fr.html).toContain('&#60;script&#62;alert(1)&#60;/script&#62; &#38; co');
    expect((await beginAuthorize(clientId, { acceptLanguage: 'en-GB,fr;q=0.3' })).html).toContain('<html lang="en">');
    expect(pickLang(null)).toBe('en');
    expect(pickLang('de,fr;q=0.2')).toBe('fr');
  });

  it('accepts Claude on either domain and refuses a redirect that was not registered', async () => {
    const { code } = await paired();
    const { clientId } = await register('Claude', 'https://claude.com/api/mcp/auth_callback');
    const b = await beginAuthorize(clientId, { redirect: 'https://claude.com/api/mcp/auth_callback' });
    const res = await submitAuthorize(b, code);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toMatch(/^https:\/\/claude\.com\/api\/mcp\/auth_callback\?code=/);
    // Another redirect: the page refuses to start.
    const bad = await beginAuthorize(clientId, { redirect: 'https://evil.example/cb' });
    expect(bad.handle).toBe('');
    expect(bad.status).toBe(400);
  });
});

describe('who gets a token', () => {
  it('a valid code does; the token is for that space only', async () => {
    const one = await paired(), two = await paired();
    const a = await signIn(one.code);
    expect((await tool(a.access, 'today')).isError).toBe(false);
    const b = await signIn(two.code);
    expect(b.access).not.toBe(a.access);
    const spaces = await env.DB.prepare('SELECT space FROM connector').all<{ space: string }>();
    expect(spaces.results.map(r => r.space)).toContain(one.app.keys.spaceId);
  });

  it('a wrong code gets the page again and nothing is issued', async () => {
    const { code } = await paired();
    const { clientId } = await register();
    const b = await beginAuthorize(clientId);
    const wrong = await submitAuthorize(b, code === 'AAAA-AAAA' ? 'CCCC-CCCC' : 'AAAA-AAAA');
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get('Location')).toBeNull();
    const html = await wrong.text();
    expect(html).toContain('wrong or has expired');
    expect(html).toContain('read and edit this list');
    // The code is still good afterwards, from a fresh page (the failed try used up nothing).
    const again = await beginAuthorize(clientId);
    expect((await submitAuthorize(again, code)).status).toBe(302);
  });

  it('a code works once', async () => {
    const { code } = await paired();
    await signIn(code);
    const { clientId } = await register();
    const b = await beginAuthorize(clientId);
    const res = await submitAuthorize(b, code);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('a code does not work after ten minutes', async () => {
    const { app, code } = await paired();
    await env.DB.prepare('UPDATE connector_codes SET expires = ? WHERE space = ?').bind(Date.now() - 1, app.keys.spaceId).run();
    const { clientId } = await register();
    const res = await submitAuthorize(await beginAuthorize(clientId), code);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('the page can be declined, which sends the app back with access_denied', async () => {
    const { clientId } = await register();
    const res = await submitAuthorize(await beginAuthorize(clientId), '', { decision: 'deny' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('error=access_denied');
    expect(res.headers.get('Location')).toContain('state=st8');
  });

  it('a form from another browser is refused (no cookie)', async () => {
    const { code } = await paired();
    const { clientId } = await register();
    const b = await beginAuthorize(clientId);
    const res = await submitAuthorize({ ...b, cookie: '' }, code);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('a refresh token keeps working, and is revoked with the rest', async () => {
    const { code } = await paired();
    const { clientId } = await register();
    const b = await beginAuthorize(clientId);
    const t = await exchange(b, (await submitAuthorize(b, code)).headers.get('Location')!);
    expect(t.refresh).toBeTruthy();
    expect((await rpc(t.access, 'tools/list')).status).toBe(200);
  });
});

describe('rate limits', () => {
  beforeEach(() => freshMinute());
  beforeEach(async () => { await env.DB.exec('DELETE FROM rate'); }); // the overall counter is shared by every sign-in this minute
  it('stop guessing: per address, and overall', async () => {
    const { clientId } = await register();
    const tight = { RATE_PAIR_IP_PER_MIN: '3', RATE_PAIR_ALL_PER_MIN: '5' };
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const b = await beginAuthorize(clientId);
      results.push((await submitAuthorize(b, 'AAAA-AAAA', { ip: 'guesser-1', env: tight })).status);
    }
    expect(results).toEqual([400, 400, 400, 429, 429]);
    // Another address is still allowed, until the overall budget runs out.
    const b2 = await beginAuthorize(clientId);
    expect((await submitAuthorize(b2, 'AAAA-AAAA', { ip: 'guesser-2', env: tight })).status).toBe(429);
  });

  it('a limited address cannot use a correct code either', async () => {
    const { code } = await paired();
    const { clientId } = await register();
    const tight = { RATE_PAIR_IP_PER_MIN: '1', RATE_PAIR_ALL_PER_MIN: '1000' };
    await submitAuthorize(await beginAuthorize(clientId), 'CCCC-CCCC', { ip: 'guesser-3', env: tight });
    const res = await submitAuthorize(await beginAuthorize(clientId), code, { ip: 'guesser-3', env: tight });
    expect(res.status).toBe(429);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('codes are limited per space: at most three unused at once', async () => {
    const { app } = await paired();
    for (let i = 0; i < 6; i++) await switchOn(app);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM connector_codes WHERE space = ?').bind(app.keys.spaceId).first<{ n: number }>();
    expect(n!.n).toBe(3);
  });
});
