// The manual as plain static pages (docs/dev/manual.md): one HTML file per page of docs/manual/<language>/, written at build time
// from the same Markdown and the same reader as the in-app viewer (markdown.ts), so they never go stale. English is served at
// /manual/ and French at /manual/fr/. No script, no third-party file: one inline stylesheet, the app's own font files and the
// The af Klint palette's tokens, light and dark by the device's setting. Used by vite.config.ts; `renderPage` is pure and tested.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { translate, type Lang } from '../i18n';
import { classifyHref, parseMarkdown, shotName, titleOf, type Block, type Inline } from './markdown';
import { PAGES, isPage, type PageSlug } from './pages';

const LANGS: Lang[] = ['en', 'fr'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where a page of a language lives, from the site root. */
export const pagePath = (l: Lang, slug: PageSlug) => `manual/${l === 'fr' ? 'fr/' : ''}${slug === 'index' ? 'index' : slug}.html`;
/** The link to a page, from a page of the same language (they sit in one folder). */
const pageHref = (slug: PageSlug) => (slug === 'index' ? './' : `${slug}.html`);
/** The folder the pictures are in, from a page of this language. */
const shotsDir = (l: Lang) => (l === 'fr' ? '../shots' : 'shots');

function inline(c: Inline[], l: Lang): string {
  return c.map(x => {
    if (x.t === 'text') return esc(x.v);
    if (x.t === 'code') return `<code>${esc(x.v)}</code>`;
    if (x.t === 'b') return `<strong>${inline(x.c, l)}</strong>`;
    if (x.t === 'i') return `<em>${inline(x.c, l)}</em>`;
    if (x.t === 'img') {
      const name = shotName(x.src);
      if (!name) return esc(x.alt);
      const src = (theme: string) => `${shotsDir(l)}/${l}-${theme}/${name}.png`;
      return `<picture><source media="(prefers-color-scheme: dark)" srcset="${src('dark')}"><img class="shot" src="${src('light')}" alt="${esc(x.alt)}" width="375" loading="lazy"></picture>`;
    }
    const to = classifyHref(x.href);
    const inner = inline(x.c, l);
    if (to.kind === 'page' && isPage(to.slug)) return `<a href="${pageHref(to.slug)}">${inner}</a>`;
    if (to.kind === 'out') return `<a href="${esc(to.href)}" rel="noopener noreferrer">${inner}</a>`;
    return inner;
  }).join('');
}

function blocks(bs: Block[], l: Lang): string {
  return bs.map(b => {
    if (b.t === 'h') return `<h${b.n}>${inline(b.c, l)}</h${b.n}>`;
    if (b.t === 'ul') return `<ul>${b.items.map(i => `<li>${inline(i, l)}</li>`).join('')}</ul>`;
    if (b.t === 'ol') return `<ol>${b.items.map(i => `<li>${inline(i, l)}</li>`).join('')}</ol>`;
    if (b.t === 'quote') return `<blockquote>${inline(b.c, l)}</blockquote>`;
    if (b.t === 'pre') return `<pre>${esc(b.v)}</pre>`;
    if (b.t === 'hr') return '<hr>';
    return b.c.length === 1 && b.c[0]!.t === 'img' ? `<figure>${inline(b.c, l)}</figure>` : `<p>${inline(b.c, l)}</p>`;
  }).join('\n');
}

const CSS_TOKENS_LIGHT = '--ground:#EBEBE6;--card:#F7F7F3;--ink:#1F2E2E;--ink-2:#4E5D5C;--line:#C5CBC6;--accent:#2D6A67;--accent-ink:#FFFFFF;--accent-soft:#D5E5E2;--shadow:0 1px 2px rgba(31,46,46,.06)';
const CSS_TOKENS_DARK = '--ground:#0B0C10;--card:#16161F;--ink:#ECE8F0;--ink-2:#A8A0B4;--line:#34303F;--accent:#8DB0E6;--accent-ink:#0B0C10;--accent-soft:#1A2440;--shadow:0 1px 2px rgba(0,0,0,.4)';
const FONTS = [['400', 'normal'], ['600', 'normal'], ['700', 'normal']] as const;
const fontFile = (w: string) => `atkinson-hyperlegible-next-latin-${w}-normal.woff2`;

const CSS = `
${FONTS.map(([w]) => `@font-face{font-family:"Atkinson Hyperlegible Next";font-weight:${w};font-style:normal;font-display:swap;src:url(FONTDIR/${fontFile(w)}) format("woff2")}`).join('\n')}
:root{${CSS_TOKENS_LIGHT};color-scheme:light}
@media (prefers-color-scheme:dark){:root{${CSS_TOKENS_DARK};color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ground);color:var(--ink);font:400 17px/1.6 "Atkinson Hyperlegible Next","Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:break-word}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px;background:var(--card);padding:8px 12px;border-radius:8px;z-index:2}
.wrap{max-width:720px;margin:0 auto;padding:0 16px}
header.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:20px 0 8px}
header.top .name{font-weight:700;font-size:22px;letter-spacing:-.01em;color:var(--ink);text-decoration:none}
header.top nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}
.open{display:inline-block;background:var(--accent);color:var(--accent-ink);font-weight:600;text-decoration:none;border-radius:999px;padding:10px 20px;min-height:44px;line-height:24px}
.open:hover{filter:brightness(1.08)}
a{color:var(--accent)}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
main{padding:16px 0 24px}
h1{font-size:clamp(28px,7vw,36px);line-height:1.15;letter-spacing:-.01em;margin:24px 0 16px}
h2{font-size:22px;line-height:1.25;margin:40px 0 8px}
h3{font-size:18px;margin:28px 0 4px}h4{font-size:16px;margin:20px 0 4px}
p,ul,ol,blockquote,pre,figure{margin:0 0 16px}
ul,ol{padding-left:1.4em}li{margin-bottom:6px}
blockquote{border-left:3px solid var(--accent);background:var(--card);padding:10px 14px;border-radius:0 10px 10px 0;color:var(--ink-2)}
code{font-family:"Atkinson Hyperlegible Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:var(--card);padding:1px 5px;border-radius:5px}
pre{background:var(--card);border-radius:10px;padding:12px 14px;overflow-x:auto;font:14px/1.5 "Atkinson Hyperlegible Mono",ui-monospace,Menlo,Consolas,monospace}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
figure{display:flex;justify-content:center}
.shot{display:block;max-width:100%;height:auto;border-radius:14px;box-shadow:var(--shadow);border:1px solid var(--line)}
nav.pn{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;border-top:1px solid var(--line);margin-top:40px;padding-top:16px}
nav.pn a{display:inline-block;padding:10px 0;min-height:44px;line-height:1.35}
nav.pn span:last-child{text-align:right;margin-left:auto}
nav.pn small{color:var(--ink-2)}
footer{padding:0 0 48px;color:var(--ink-2);font-size:15px}
`.trim();

/** One page, whole: `from` is the language of the page; `prev` and `next` are its neighbours in reading order. */
export function renderPage(l: Lang, slug: PageSlug, md: string): string {
  const tr = (k: Parameters<typeof translate>[1]) => translate(l, k);
  const bs = parseMarkdown(md);
  const i = PAGES.indexOf(slug);
  const prev = i > 0 ? PAGES[i - 1]! : null, next = i < PAGES.length - 1 ? PAGES[i + 1]! : null;
  const other: Lang = l === 'en' ? 'fr' : 'en';
  // From /manual/<page>.html to /manual/fr/<page>.html and back (the index is the folder itself).
  const switchHref = l === 'en' ? `fr/${slug === 'index' ? '' : slug + '.html'}` : `../${slug === 'index' ? '' : slug + '.html'}`;
  const titles = (s: PageSlug) => esc(titleOf(parseMarkdown(readMd(l, s))));
  const title = esc(titleOf(bs));
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'";
  const css = CSS.replace(/FONTDIR/g, l === 'fr' ? '../fonts' : 'fonts');
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#2D6A67">
<title>${title}${slug === 'index' ? '' : ' · ' + esc(translate(l, 'appName'))}</title>
<link rel="icon" href="${l === 'fr' ? '../../' : '../'}icons/icon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#text">${esc(tr('manualSiteSkip'))}</a>
<div class="wrap">
<header class="top">
<a class="name" href="${pageHref('index')}">${esc(translate(l, 'appName'))}</a>
<nav>
<a href="${switchHref}" hreflang="${other}" lang="${other}" aria-label="${esc(tr('manualSiteLangLabel'))}">${esc(tr('manualSiteLang'))}</a>
<a class="open" href="/">${esc(tr('manualSiteOpen'))}</a>
</nav>
</header>
<main id="text">
${blocks(bs, l)}
${slug === 'index' ? '' : `<p><a href="${pageHref('index')}">← ${esc(tr('manualContents'))}</a></p>`}
<nav class="pn" aria-label="${esc(tr('manualContents'))}">
<span>${prev ? `<a href="${pageHref(prev)}" rel="prev"><small>← ${esc(tr('manualSitePrev'))}</small><br>${titles(prev)}</a>` : ''}</span>
<span>${next ? `<a href="${pageHref(next)}" rel="next"><small>${esc(tr('manualSiteNext'))} →</small><br>${titles(next)}</a>` : ''}</span>
</nav>
</main>
<footer><a class="open" href="/">${esc(tr('manualSiteOpen'))}</a></footer>
</div>
</body>
</html>
`;
}

let root = process.cwd();
const readMd = (l: Lang, slug: PageSlug) => readFileSync(join(root, 'docs/manual', l, slug + '.md'), 'utf8');

/** Writes the pages and their fonts into the build (dist/manual/…). */
export function manualSite(): Plugin {
  return {
    name: 'manual-site',
    apply: 'build',
    configResolved(c) { root = c.root; },
    generateBundle() {
      const fonts = join(root, 'node_modules/@fontsource/atkinson-hyperlegible-next/files');
      for (const [w] of FONTS) this.emitFile({ type: 'asset', fileName: `manual/fonts/${fontFile(w)}`, source: readFileSync(join(fonts, fontFile(w))) });
      for (const l of LANGS) {
        const have = new Set(readdirSync(join(root, 'docs/manual', l)).map(f => f.replace(/\.md$/, '')));
        for (const slug of PAGES) if (have.has(slug)) this.emitFile({ type: 'asset', fileName: pagePath(l, slug), source: renderPage(l, slug, readMd(l, slug)) });
      }
    },
  };
}
