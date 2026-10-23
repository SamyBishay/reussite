// The manual's files hang together: every page is listed, every link goes to a page, every picture is one the screenshot tests make.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { classifyHref, parseMarkdown, shotName, titleOf, type Block, type Inline } from './markdown';
import { PAGES } from './pages';

const LANGS = ['en', 'fr'] as const;
const THEMES = ['light', 'dark'] as const;
const dir = (l: string) => `docs/manual/${l}`;
const pagesOf = (l: string) => (existsSync(dir(l)) ? readdirSync(dir(l)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')) : []);
const inlines = (bs: Block[]): Inline[] => bs.flatMap(b => (b.t === 'h' || b.t === 'p' || b.t === 'quote' ? b.c : b.t === 'ul' || b.t === 'ol' ? b.items.flat() : []));
const walk = (xs: Inline[]): Inline[] => xs.flatMap(x => (x.t === 'b' || x.t === 'i' || x.t === 'a' ? [x, ...walk(x.c)] : [x]));
// The shots the spec takes: shot(page, 'name').
const SHOTS = [...readFileSync('tests/manual/manual.spec.ts', 'utf8').matchAll(/shot\(page, '([a-z0-9-]+)'/g)].map(m => m[1]!);

describe('the manual', () => {
  it('has an English page for every entry in the reading order, and no other', () => {
    expect(pagesOf('en').sort()).toEqual([...PAGES].sort());
  });
  for (const l of LANGS) for (const slug of pagesOf(l)) {
    const blocks = parseMarkdown(readFileSync(`${dir(l)}/${slug}.md`, 'utf8'));
    const all = walk(inlines(blocks));
    it(`${l}/${slug}: a title, links to pages that exist, pictures the tests make`, () => {
      expect(titleOf(blocks), 'a first heading').not.toBe('');
      for (const x of all) {
        if (x.t === 'a') {
          const to = classifyHref(x.href);
          expect(to.kind, x.href).not.toBe('none');
          if (to.kind === 'page') expect(PAGES as readonly string[], x.href).toContain(to.slug);
        }
        if (x.t === 'img') expect(SHOTS, x.src).toContain(shotName(x.src) ?? '');
      }
    });
  }
  it('has every screenshot, in both languages and both themes', () => {
    for (const l of LANGS) for (const th of THEMES) for (const s of SHOTS) expect(existsSync(`public/manual/shots/${l}-${th}/${s}.png`), `${l}-${th}/${s}`).toBe(true);
  });
  it('keeps the evidence placeholders and the not-therapy line', () => {
    const text = pagesOf('en').map(s => readFileSync(`${dir('en')}/${s}.md`, 'utf8')).join('\n');
    expect(text).toContain('`[E?]`'); // the same placeholder as docs/METHOD.*.md
    expect(text).not.toContain('E-xx');
    expect(text).toContain('**Research says:**');
    expect(text).toContain('**Practice says:**');
    expect(text).toContain('doesn\'t replace therapy');
  });
});
