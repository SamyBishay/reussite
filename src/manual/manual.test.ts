// The manual's files hang together: every page is listed, every link goes to a page, every picture is one the screenshot tests make.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { classifyHref, parseMarkdown, shotName, titleOf, type Block, type Inline } from './markdown';
import { EVIDENCE, PAGES } from './pages';

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
          if (to.kind === 'page') expect([...PAGES, ...EVIDENCE] as readonly string[], x.href).toContain(to.slug);
        }
        if (x.t === 'img') expect(SHOTS, x.src).toContain(shotName(x.src) ?? '');
      }
    });
  }
  it('has a French page for every English one, with the same links and pictures', () => {
    expect(pagesOf('fr').sort()).toEqual([...PAGES].sort());
    const refs = (l: string, slug: string) => walk(inlines(parseMarkdown(readFileSync(`${dir(l)}/${slug}.md`, 'utf8'))))
      .flatMap(x => (x.t === 'a' ? [x.href] : x.t === 'img' ? [x.src] : []));
    for (const slug of PAGES) expect(refs('fr', slug), slug).toEqual(refs('en', slug));
  });
  it('writes French typography into the pages: a narrow no-break space before ; : ! ? and inside « »', () => {
    for (const slug of pagesOf('fr')) {
      const text = readFileSync(`${dir('fr')}/${slug}.md`, 'utf8').replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
      expect(text.match(/[^\s\d][ \u00a0]+[;:!?»]|«[ \u00a0]|[^\s\u202f\d(\[*«][;!?](?=\s|$)/g), slug).toBeNull();
    }
  });
  it('has every screenshot, in both languages and both themes', () => {
    for (const l of LANGS) for (const th of THEMES) for (const s of SHOTS) expect(existsSync(`public/manual/shots/${l}-${th}/${s}.png`), `${l}-${th}/${s}`).toBe(true);
  });
  it('sends each "Research says" line to the rule\'s research page, with no placeholder left, and keeps the not-therapy line', () => {
    for (const l of LANGS) for (const slug of pagesOf(l)) {
      const text = readFileSync(`${dir(l)}/${slug}.md`, 'utf8');
      expect(text, `${l}/${slug}`).not.toContain('[E?]');
      expect(text, `${l}/${slug}`).not.toMatch(/untested here|non testé ici/);
      for (const line of text.split('\n').filter(x => /^\*\*(Research says|La recherche dit)/.test(x))) {
        if (!/not applicable|sans objet/.test(line)) expect(line, `${l}/${slug}`).toMatch(/\]\(research(-[0-9a-z]+)?\.md\)/);
      }
    }
    const text = pagesOf('en').map(s => readFileSync(`${dir('en')}/${s}.md`, 'utf8')).join('\n');
    const fr = pagesOf('fr').map(s => readFileSync(`${dir('fr')}/${s}.md`, 'utf8')).join('\n');
    expect(fr).toContain('**La recherche dit');
    expect(fr).toContain('**La pratique dit');
    expect(text).toContain('**Research says:**');
    expect(text).toContain('**Practice says:**');
    expect(text).toContain('doesn\'t replace therapy');
    expect(fr).toContain('ne remplace');
  });
});

describe('the research pages (docs/evidence)', () => {
  const edir = (l: string) => `docs/evidence/${l}`;
  const read = (l: string, s: string) => readFileSync(`${edir(l)}/${s}.md`, 'utf8');
  it('has a page for every entry, in English and in French, and no other', () => {
    for (const l of LANGS) expect(readdirSync(edir(l)).map(f => f.replace(/\.md$/, '')).sort(), l).toEqual([...EVIDENCE].sort());
  });
  for (const l of LANGS) for (const slug of EVIDENCE) {
    it(`${l}/${slug}: a title, links that go somewhere, a doi link for each source`, () => {
      const blocks = parseMarkdown(read(l, slug));
      expect(titleOf(blocks)).not.toBe('');
      const links = walk(inlines(blocks)).flatMap(x => (x.t === 'a' ? [x.href] : []));
      for (const href of links) {
        const to = classifyHref(href);
        expect(to.kind, href).not.toBe('none');
        if (to.kind === 'page') expect([...PAGES, ...EVIDENCE] as readonly string[], href).toContain(to.slug);
      }
      if (slug !== 'research') {
        const dois = links.filter(h => h.startsWith('https://doi.org/10.'));
        expect(dois.length, 'sources').toBeGreaterThanOrEqual(2);
        expect(read(l, slug)).toMatch(l === 'fr' ? /\*\*Niveau\u202f: / : /\*\*Grade: /);
      }
    });
  }
  it('has the same links in both languages', () => {
    const refs = (l: string, s: string) => walk(inlines(parseMarkdown(read(l, s)))).flatMap(x => (x.t === 'a' ? [x.href] : []));
    for (const slug of EVIDENCE) expect(refs('fr', slug), slug).toEqual(refs('en', slug));
  });
  it('writes French typography: a narrow no-break space before ; : ! ? and inside « »', () => {
    for (const slug of EVIDENCE) {
      const text = read('fr', slug).split('## Sources')[0]!.replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
      expect(text.match(/[^\s\d][  ]+[;:!?»]|«[  ]|[^\s \d(\[*«][;!?](?=\s|$)/g), slug).toBeNull();
    }
  });
  it('says what it does not claim: no treatment, and the owner\'s note on rule 4', () => {
    expect(read('en', 'research')).toContain('does not treat ADHD');
    expect(read('fr', 'research')).toContain('ne traite pas le TDAH');
    expect(read('en', 'research-4')).toContain('did not change the bias');
    expect(read('en', 'research-4')).not.toMatch(/seeing your own ratio is how the bias changes/i);
  });
});
