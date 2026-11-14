// The picture a chat app shows for a link to Réussite (docs/dev/hello.md): 1200×630, the mark, the name and one line, in the af Klint
// palette and the app's own font. Run `node scripts/og-image.mjs` after changing the mark or the line; it writes public/hello/og.png.
import { firefox } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = p => readFileSync(join(root, p)).toString('base64');
const font = w => `@font-face{font-family:"A";font-weight:${w};src:url(data:font/woff2;base64,${b64(`node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-${w}-normal.woff2`)}) format("woff2")}`;
const html = `<!doctype html><meta charset="utf-8"><style>
${font(400)}${font(700)}
*{box-sizing:border-box}html,body{margin:0}
body{width:1200px;height:630px;background:#EBEBE6;color:#1F2E2E;font-family:"A",sans-serif;display:flex;align-items:center;gap:64px;padding:0 88px}
img{height:400px;width:auto;flex:none}
h1{font-size:104px;line-height:1;margin:0 0 28px;letter-spacing:-.02em}
p{font-size:36px;line-height:1.3;margin:0;color:#4E5D5C}
.s{margin-top:36px;font-size:56px;letter-spacing:.2em;display:flex;gap:20px}
</style>
<img src="data:image/webp;base64,${b64('src/assets/dove/mark-light.webp')}" alt="">
<div><h1>Réussite</h1><p>Everything you have to do is a card.<br>Play them one at a time.</p>
<div class="s"><span style="color:#2F4C8E">♠</span><span style="color:#735C1F">♦</span><span style="color:#2B6964">♣</span><span style="color:#9C4560">♥</span></div></div>`;

const browser = await firefox.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, 'public/hello/og.png') });
await browser.close();
console.log('public/hello/og.png written');
