// The manual as plain static pages (docs/dev/manual.md): one HTML file per page of docs/manual/<language>/, written at build time
// from the same Markdown and the same reader as the in-app viewer (markdown.ts), so they never go stale. English is served at
// /manual/ and French at /manual/fr/. No script, no third-party file: one inline stylesheet, the app's own font files and the
// The af Klint palette's tokens, light and dark by the device's setting. Used by vite.config.ts; `renderPage` is pure and tested.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { translate, type Lang } from '../i18n';
import { classifyHref, parseMarkdown, plain, shotName, titleOf, type Block, type Inline } from './markdown';
import { PAGES, isPage, type PageSlug } from './pages';

const LANGS: Lang[] = ['en', 'fr'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where a page of a language lives, from the site root. */
export const pagePath = (l: Lang, slug: PageSlug) => `manual/${l === 'fr' ? 'fr/' : ''}${slug === 'index' ? 'index' : slug}.html`;
/** The link to a page, from a page of the same language (they sit in one folder). */
const pageHref = (slug: PageSlug) => (slug === 'index' ? './' : `${slug}.html`);
/** The folder the pictures are in, from a page of this language. */
const shotsDir = (l: Lang) => (l === 'fr' ? '../shots' : 'shots');

/** Where a page's pictures and the manual's pages are, from that page. The manual's own pages sit beside one another; the hello page is a folder away. */
interface Where { shots: string; page: (slug: PageSlug) => string }
const inManual = (l: Lang): Where => ({ shots: shotsDir(l), page: pageHref });

function inline(c: Inline[], l: Lang, w: Where = inManual(l)): string {
  return c.map(x => {
    if (x.t === 'text') return esc(x.v);
    if (x.t === 'code') return `<code>${esc(x.v)}</code>`;
    if (x.t === 'b') return `<strong>${inline(x.c, l, w)}</strong>`;
    if (x.t === 'i') return `<em>${inline(x.c, l, w)}</em>`;
    if (x.t === 'img') {
      const name = shotName(x.src);
      if (!name) return esc(x.alt);
      const src = (theme: string) => `${w.shots}/${l}-${theme}/${name}.png`;
      return `<picture><source media="(prefers-color-scheme: dark)" srcset="${src('dark')}"><img class="shot" src="${src('light')}" alt="${esc(x.alt)}" width="375" loading="lazy"></picture>`;
    }
    const to = classifyHref(x.href);
    const inner = inline(x.c, l, w);
    if (to.kind === 'page' && isPage(to.slug)) return `<a href="${w.page(to.slug)}">${inner}</a>`;
    if (to.kind === 'out') return `<a href="${esc(to.href)}" rel="noopener noreferrer">${inner}</a>`;
    return inner;
  }).join('');
}

function blocks(bs: Block[], l: Lang, w: Where = inManual(l)): string {
  return bs.map(b => {
    if (b.t === 'h') return `<h${b.n}>${inline(b.c, l, w)}</h${b.n}>`;
    if (b.t === 'ul') return `<ul>${b.items.map(i => `<li>${inline(i, l, w)}</li>`).join('')}</ul>`;
    if (b.t === 'ol') return `<ol>${b.items.map(i => `<li>${inline(i, l, w)}</li>`).join('')}</ol>`;
    if (b.t === 'quote') return `<blockquote>${inline(b.c, l, w)}</blockquote>`;
    if (b.t === 'pre') return `<pre>${esc(b.v)}</pre>`;
    if (b.t === 'hr') return '<hr>';
    return b.c.length === 1 && b.c[0]!.t === 'img' ? `<figure>${inline(b.c, l, w)}</figure>` : `<p>${inline(b.c, l, w)}</p>`;
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

// ---------- the hello page ----------
// What Réussite is, for someone who was sent the link (docs/dev/hello.md): /hello/ in English and /hello/fr/ in French, written from
// docs/hello/<language>.md with the manual's reader and stylesheet. It carries the tags a chat app reads to show a preview of the link.

/** Where the hello page of a language lives, from the site root. */
export const helloPath = (l: Lang) => `hello/${l === 'fr' ? 'fr/' : ''}index.html`;
const HELLO_CSS = `
.hero{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px;padding:24px 0 8px}
.hero img{width:112px;height:auto;flex:none}
.hero .mark-d{display:none}
@media (prefers-color-scheme:dark){.hero .mark-l{display:none}.hero .mark-d{display:block}}
.hero div{flex:1 1 260px;min-width:0}
.hero h1{margin:0 0 8px}
.hero p{margin:0 0 16px;font-size:19px;line-height:1.45}
main h2{margin-top:48px}
.shot{max-width:min(100%,300px)}
`.trim();

/**
 * The hello page, whole. `appUrl` is the address the app is served at (`VITE_APP_URL`, no trailing slash): with it the preview tags
 * carry a picture and the page's own address, which must be absolute; without it they carry the words only.
 */
export function renderHello(l: Lang, md: string, appUrl = ''): string {
  const tr = (k: Parameters<typeof translate>[1]) => translate(l, k);
  const bs = parseMarkdown(md);
  // The first heading and the paragraph under it are the hero; the rest is the page.
  const lead = bs[1]?.t === 'p' ? bs[1] : null;
  const rest = bs.slice(lead ? 2 : 1);
  const up = l === 'fr' ? '../../' : '../';
  const where: Where = { shots: `${up}manual/shots`, page: slug => `${up}manual/${l === 'fr' ? 'fr/' : ''}${slug === 'index' ? '' : slug + '.html'}` };
  const other: Lang = l === 'en' ? 'fr' : 'en';
  const title = esc(titleOf(bs));
  const desc = esc(lead ? plain(lead.c) : '');
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'";
  const css = CSS.replace(/FONTDIR/g, `${up}manual/fonts`) + '\n' + HELLO_CSS;
  const base = appUrl.replace(/\/+$/, '');
  const og = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(translate(l, 'appName'))}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:locale" content="${l === 'fr' ? 'fr_FR' : 'en_GB'}">`,
    ...(base ? [`<meta property="og:url" content="${esc(base)}/hello/${l === 'fr' ? 'fr/' : ''}">`, `<meta property="og:image" content="${esc(base)}/hello/og.png">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta name="twitter:card" content="summary_large_image">`] : []),
  ].join('\n');
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#2D6A67">
<title>${title}</title>
<meta name="description" content="${desc}">
${og}
<link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#text">${esc(tr('manualSiteSkip'))}</a>
<div class="wrap">
<header class="top">
<a class="name" href="./">${esc(translate(l, 'appName'))}</a>
<nav>
<a href="${l === 'en' ? 'fr/' : '../'}" hreflang="${other}" lang="${other}" aria-label="${esc(tr('helloLangLabel'))}">${esc(tr('manualSiteLang'))}</a>
<a class="open" href="/">${esc(tr('manualSiteOpen'))}</a>
</nav>
</header>
<main id="text">
<div class="hero">
<img class="mark-l" src="${l === 'fr' ? '../' : ''}mark-light.webp" alt="" width="112">
<img class="mark-d" src="${l === 'fr' ? '../' : ''}mark-dark.webp" alt="" width="112">
<div>
<h1>${title}</h1>
${lead ? `<p>${inline(lead.c, l, where)}</p>` : ''}
<a class="open" href="/">${esc(tr('manualSiteOpen'))}</a>
</div>
</div>
${blocks(rest, l, where)}
</main>
<footer><a class="open" href="/">${esc(tr('manualSiteOpen'))}</a></footer>
</div>
</body>
</html>
`;
}

/** The words a chat app shows for the app's own address: added to the built index.html (the app itself never reads them). */
export function previewTags(md: string, appUrl = ''): string {
  const bs = parseMarkdown(md);
  const lead = bs[1]?.t === 'p' ? bs[1] : null;
  const desc = esc(lead ? plain(lead.c) : ''), title = esc(titleOf(bs)), base = appUrl.replace(/\/+$/, '');
  return [
    `<meta name="description" content="${desc}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    ...(base ? [`<meta property="og:url" content="${esc(base)}/" />`, `<meta property="og:image" content="${esc(base)}/hello/og.png" />`, `<meta property="og:image:width" content="1200" />`, `<meta property="og:image:height" content="630" />`, `<meta name="twitter:card" content="summary_large_image" />`] : []),
  ].join('\n    ');
}

let root = process.cwd();
const readHello = (l: Lang) => readFileSync(join(root, 'docs/hello', l + '.md'), 'utf8');
const readMd = (l: Lang, slug: PageSlug) => readFileSync(join(root, 'docs/manual', l, slug + '.md'), 'utf8');

/** Writes the pages and their fonts into the build (dist/manual/…). */
export function manualSite(appUrl = ''): Plugin {
  return {
    name: 'manual-site',
    apply: 'build',
    configResolved(c) { root = c.root; },
    transformIndexHtml: (html: string) => html.replace('<title>', previewTags(readHello('en'), appUrl) + '\n    <title>'),
    generateBundle() {
      for (const l of LANGS) this.emitFile({ type: 'asset', fileName: helloPath(l), source: renderHello(l, readHello(l), appUrl) });
      for (const th of ['light', 'dark']) this.emitFile({ type: 'asset', fileName: `hello/mark-${th}.webp`, source: readFileSync(join(root, 'src/assets/dove', `mark-${th}.webp`)) });
      const fonts = join(root, 'node_modules/@fontsource/atkinson-hyperlegible-next/files');
      for (const [w] of FONTS) this.emitFile({ type: 'asset', fileName: `manual/fonts/${fontFile(w)}`, source: readFileSync(join(fonts, fontFile(w))) });
      for (const l of LANGS) {
        const have = new Set(readdirSync(join(root, 'docs/manual', l)).map(f => f.replace(/\.md$/, '')));
        for (const slug of PAGES) if (have.has(slug)) this.emitFile({ type: 'asset', fileName: pagePath(l, slug), source: renderPage(l, slug, readMd(l, slug)) });
      }
    },
  };
}
