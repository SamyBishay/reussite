import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { EVIDENCE, PAGES } from './pages';
import { renderPage, pagePath, renderHello, helloPath, previewTags } from './site';

const md = (l: string, s: string) => readFileSync(`docs/manual/${l}/${s}.md`, 'utf8');

/** Where a link in the built site comes from in the repository. */
function source(from: string, url: string): string | null {
  const to = posix.normalize(posix.join(posix.dirname(from), url));
  const m = /^manual\/(fr\/)?([^/]*)$/.exec(to);
  if (m && EVIDENCE.includes(m[2]!.replace(/\.html$/, '') as (typeof EVIDENCE)[number])) return `docs/evidence/${m[1] ? 'fr' : 'en'}/${m[2]!.replace(/\.html$/, '')}.md`;
  if (m && (to.endsWith('.html') || to.endsWith('/') || to === 'manual/fr' || to === 'manual')) return `docs/manual/${m[1] ? 'fr' : 'en'}/${m[2]!.replace(/\.html$/, '') || 'index'}.md`;
  if (to.startsWith('manual/fonts/')) return null; // emitted by the plugin from node_modules
  if (/^hello\/(fr\/)?$/.test(to)) return `docs/hello/${to.includes('fr') ? 'fr' : 'en'}.md`;
  const mark = /^hello\/(mark-(?:light|dark)\.webp)$/.exec(to);
  if (mark) return `src/assets/dove/${mark[1]}`; // copied by the plugin
  return `public/${to}`;
}

describe('the public manual pages', () => {
  for (const l of ['en', 'fr'] as const) {
    it(`${l}: every page renders with no script, an app link, and links and pictures that exist`, () => {
      for (const slug of PAGES) {
        const html = renderPage(l, slug, md(l, slug));
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain('<a class="open" href="/">');
        expect(html).toContain(`<html lang="${l}">`);
        for (const m of html.matchAll(/(?:href|src|srcset)="([^"#]+)"/g)) {
          const u = m[1]!;
          if (/^(https?:|mailto:|\/$)/.test(u) || u.startsWith('http')) continue;
          const src = source(pagePath(l, slug), u);
          if (src) expect(existsSync(src), `${l}/${slug}: ${u} -> ${src}`).toBe(true);
        }
      }
    });
  }
});

describe('the public research pages', () => {
  const ev = (l: string, s: string) => readFileSync(`docs/evidence/${l}/${s}.md`, 'utf8');
  for (const l of ['en', 'fr'] as const) {
    it(`${l}: the index and every rule's page are built, in order, with no script, and their links exist`, () => {
      expect(pagePath(l, 'research')).toBe(l === 'fr' ? 'manual/fr/research.html' : 'manual/research.html');
      for (const slug of EVIDENCE) {
        const html = renderPage(l, slug, ev(l, slug));
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain(`<html lang="${l}">`);
        expect(html).toContain('<a class="open" href="/">');
        for (const m of html.matchAll(/(?:href|src|srcset)="([^"#]+)"/g)) {
          const u = m[1]!;
          if (/^(https?:|mailto:|\/$)/.test(u)) continue;
          const src = source(pagePath(l, slug), u);
          if (src) expect(existsSync(src), `${l}/${slug}: ${u} -> ${src}`).toBe(true);
        }
      }
      // The index links to every page; the first rule's page leads on to the second.
      const index = renderPage(l, 'research', ev(l, 'research'));
      for (const slug of EVIDENCE.slice(1)) expect(index).toContain(`href="${slug}.html"`);
      expect(renderPage(l, 'research-1', ev(l, 'research-1'))).toContain('href="research-2.html" rel="next"');
    });
  }
});

describe('the hello page', () => {
  const hello = (l: string) => readFileSync(`docs/hello/${l}.md`, 'utf8');
  for (const l of ['en', 'fr'] as const) {
    it(`${l}: renders with no script, an app link, and links and pictures that exist`, () => {
      const html = renderHello(l, hello(l), 'https://example.org/');
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain('<a class="open" href="/">');
      expect(html).toContain(`<html lang="${l}">`);
      expect(html.match(/<h1>/g)).toHaveLength(1);
      for (const m of html.matchAll(/(?:href|src|srcset)="([^"#]+)"/g)) {
        const u = m[1]!;
        if (/^(https?:|mailto:|\/$)/.test(u)) continue;
        const src = source(helloPath(l), u);
        if (src) expect(existsSync(src), `${l}: ${u} -> ${src}`).toBe(true);
      }
    });
  }
  it('says the same things in both languages: the same headings, pictures and links', () => {
    const shape = (l: string) => hello(l).split('\n').filter(x => /^#|^!\[|\]\(/.test(x)).map(x => x.replace(/^(#+).*/, '$1').replace(/!\[[^\]]*\]/g, '![]').replace(/\[[^\]]*\]\(([^)]*)\)/g, '($1)').replace(/^[^!(#]*/, '').replace(/\)[^)]*$/, ')'));
    expect(shape('fr')).toEqual(shape('en'));
  });
  it('writes French typography: a narrow no-break space before ; : ! ? and inside « »', () => {
    const text = hello('fr').replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
    expect(text.match(/[^\s\d][ \u00a0]+[;:!?»]|«[ \u00a0]|[^\s\u202f\d(\[*«][;!?](?=\s|$)/g)).toBeNull();
  });
  it('carries the preview tags: with the app address a picture and the page address, without it the words only', () => {
    const withUrl = renderHello('en', hello('en'), 'https://example.org/');
    expect(withUrl).toContain('<meta property="og:title" content="Réussite">');
    expect(withUrl).toMatch(/<meta property="og:description" content="A planner for people who find starting harder than working\./);
    expect(withUrl).toContain('<meta property="og:image" content="https://example.org/hello/og.png">');
    expect(withUrl).toContain('<meta property="og:url" content="https://example.org/hello/">');
    expect(renderHello('fr', hello('fr'), 'https://example.org')).toContain('<meta property="og:url" content="https://example.org/hello/fr/">');
    const bare = renderHello('en', hello('en'));
    expect(bare).toContain('og:description');
    expect(bare).not.toContain('og:image');
    expect(existsSync('public/hello/og.png')).toBe(true);
  });
  it('gives the app page the same words', () => {
    const tags = previewTags(hello('en'), 'https://example.org');
    expect(tags).toContain('<meta name="description" content="A planner for people who find starting harder than working.');
    expect(tags).toContain('<meta property="og:image" content="https://example.org/hello/og.png" />');
    expect(previewTags(hello('en'))).not.toContain('og:image');
  });
});
