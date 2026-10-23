import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { PAGES } from './pages';
import { renderPage, pagePath } from './site';

const md = (l: string, s: string) => readFileSync(`docs/manual/${l}/${s}.md`, 'utf8');

/** Where a link in the built site comes from in the repository. */
function source(from: string, url: string): string | null {
  const to = posix.normalize(posix.join(posix.dirname(from), url));
  const m = /^manual\/(fr\/)?([^/]*)$/.exec(to);
  if (m && (to.endsWith('.html') || to.endsWith('/') || to === 'manual/fr' || to === 'manual')) return `docs/manual/${m[1] ? 'fr' : 'en'}/${m[2]!.replace(/\.html$/, '') || 'index'}.md`;
  if (to.startsWith('manual/fonts/')) return null; // emitted by the plugin from node_modules
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
