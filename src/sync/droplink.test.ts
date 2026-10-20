import { describe, expect, it } from 'vitest';
import { b64uEncode } from './bytes';
import { buildDropLink, DropLinkError, dropPrefix, dropUrl, parseDropFragment } from './droplink';
import { deriveInbox } from './inbox';
import { deriveKeys, generateKey } from './keys';

const cs = { v: 1, note: 'Moved the photos', changes: [{ op: 'task.update', id: 't7', set: { due: '2026-10-16' } }, { op: 'task.create', set: { title: 'Text Alex — « ça marche » ?' } }] };

async function address() {
  const k = generateKey();
  return { space: (await deriveKeys(k)).spaceId, pub: (await deriveInbox(k)).publicKey };
}
const frag = (link: string) => link.slice(link.indexOf('#'));

describe('drop link', () => {
  it('builds /drop#space.pub.mode.data and reads it back, in both modes', async () => {
    const a = await address();
    for (const mode of ['z', 'j'] as const) {
      const link = await buildDropLink('https://app.example', a, cs, mode);
      expect(link.startsWith('https://app.example/drop#' + dropPrefix(a) + mode + '.')).toBe(true);
      expect(await parseDropFragment(frag(link))).toEqual({ ...a, json: cs });
    }
  });

  it('compresses: a long change-set stays well under 8 KB as z but not as j', async () => {
    const a = await address();
    const big = { v: 1, changes: Array.from({ length: 60 }, (_, i) => ({ op: 'task.create', set: { title: 'Open Mail and answer the agency about the check-out date number ' + i, est: 10 } })) };
    expect((await buildDropLink('https://a.example', a, big, 'z')).length).toBeLessThan(2500);
    expect((await buildDropLink('https://a.example', a, big, 'j')).length).toBeGreaterThan(8000);
  });

  it('is tolerant of padding, the standard alphabet and surrounding space', async () => {
    const a = await address();
    const link = await buildDropLink('https://app.example', a, cs);
    const f = frag(link);
    const padded = f + '==';
    expect((await parseDropFragment(' ' + padded + '\n')).json).toEqual(cs);
    const at = f.indexOf('.z.') + 3;
    const std = f.slice(0, at) + f.slice(at).replace(/-/g, '+').replace(/_/g, '/');
    expect((await parseDropFragment(std)).json).toEqual(cs);
    expect((await parseDropFragment(f.slice(1))).json).toEqual(cs); // without the #
  });

  it('refuses anything else with a code, and reads nothing', async () => {
    const a = await address();
    const ok = frag(await buildDropLink('https://app.example', a, cs));
    const code = async (f: string) => parseDropFragment(f).then(() => 'ok', (e: unknown) => (e instanceof DropLinkError ? e.code : 'other'));
    expect(await code('')).toBe('format');
    expect(await code('#abc')).toBe('format');
    expect(await code('#' + a.space + '.' + a.pub)).toBe('format');
    expect(await code('#short.' + a.pub + '.z.AAAA')).toBe('format');
    expect(await code('#' + a.space + '.short.z.AAAA')).toBe('format');
    expect(await code('#' + dropPrefix(a) + 'x.AAAA')).toBe('format');
    expect(await code('#' + dropPrefix(a) + 'z.')).toBe('format');
    expect(await code('#' + dropPrefix(a) + 'z.!!!!')).toBe('data');
    expect(await code('#' + dropPrefix(a) + 'z.AAAA')).toBe('data'); // not deflate
    expect(await code('#' + dropPrefix(a) + 'z.' + b64uEncode(new Uint8Array([1, 2, 3, 4, 5])))).toBe('data');
    expect(await code('#' + dropPrefix(a) + 'j.%7Bnot json')).toBe('data');
    expect(await code('#' + dropPrefix(a) + 'j.%E0%A4%A')).toBe('data'); // bad percent-encoding
    expect(await code(ok + 'A'.repeat(70_000))).toBe('too_big');
    expect(await code(ok)).toBe('ok');
  });

  it('refuses a bomb: a tiny link that inflates past the limit', async () => {
    const a = await address();
    const huge = await buildDropLink('https://a.example', a, { v: 1, note: 'a'.repeat(400_000), changes: [] });
    expect(huge.length).toBeLessThan(8000);
    await expect(parseDropFragment(frag(huge))).rejects.toBeInstanceOf(DropLinkError);
  });

  it('names the page without doubling slashes', () => {
    expect(dropUrl('https://app.example/')).toBe('https://app.example/drop');
  });
});
