// A small Markdown reader for the manual (docs/manual): only what the pages use. It makes a tree, never HTML, so nothing a page
// says can run; the viewer draws the tree (src/manual/Manual.tsx). Links are classified here: a page of the manual, a link out
// (only the schemes in ALLOWED_SCHEMES) or nothing.
import { isAllowedLink } from '../domain/links';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'a'; href: string; c: Inline[] }
  | { t: 'img'; alt: string; src: string };

export type Block =
  | { t: 'h'; n: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'pre'; v: string }
  | { t: 'hr' };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length) { text += s[i + 1]; i += 2; continue; }
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) { flush(); out.push({ t: 'code', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (ch === '!' && s[i + 1] === '[' || ch === '[') {
      const img = ch === '!';
      const open = img ? i + 1 : i;
      const close = s.indexOf(']', open + 1);
      if (close > open && s[close + 1] === '(') {
        const end = s.indexOf(')', close + 2);
        if (end > close) {
          const label = s.slice(open + 1, close), target = s.slice(close + 2, end).trim();
          flush();
          out.push(img ? { t: 'img', alt: label, src: target } : { t: 'a', href: target, c: parseInline(label) });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '*' && s[i + 1] === '*') {
      const j = s.indexOf('**', i + 2);
      if (j > i + 2) { flush(); out.push({ t: 'b', c: parseInline(s.slice(i + 2, j)) }); i = j + 2; continue; }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] !== ' ' && (ch === '*' || i === 0 || /\W/.test(s[i - 1]!))) {
      const j = s.indexOf(ch, i + 1);
      if (j > i + 1 && s[j - 1] !== ' ' && (ch === '*' || j + 1 === s.length || /\W/.test(s[j + 1]!))) { flush(); out.push({ t: 'i', c: parseInline(s.slice(i + 1, j)) }); i = j + 1; continue; }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (l: string) => /^(#{1,4}\s|>\s?|---+\s*$|```|\s*([-*]|\d+\.)\s)/.test(l);
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      blocks.push({ t: 'pre', v: body.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { blocks.push({ t: 'h', n: h[1]!.length as 1 | 2 | 3 | 4, c: parseInline(h[2]!) }); i++; continue; }
    if (/^---+\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ''));
      blocks.push({ t: 'quote', c: parseInline(body.join(' ').trim()) });
      continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]!);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        const parts = [m[2]!];
        i++;
        // A continuation: an indented line that is not another item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*]|\d+\.)\s/.test(lines[i]!)) parts.push(lines[i++]!.trim());
        items.push(parseInline(parts.join(' ')));
      }
      blocks.push(ordered ? { t: 'ol', items } : { t: 'ul', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !(para.length && startsBlock(lines[i]!))) para.push(lines[i++]!.trim());
    blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** The page's own title: its first heading, as plain text. */
export function titleOf(blocks: Block[]): string {
  const h = blocks.find(b => b.t === 'h');
  return h && h.t === 'h' ? plain(h.c) : '';
}
export function plain(c: Inline[]): string {
  return c.map(x => (x.t === 'text' || x.t === 'code' ? x.v : x.t === 'img' ? x.alt : plain(x.c))).join('');
}

export type Target = { kind: 'page'; slug: string } | { kind: 'out'; href: string } | { kind: 'none' };

/** Where a link goes. A page of the manual is a bare name or `name.md` (a `#part` is ignored); anything else must be an allowed link. */
export function classifyHref(href: string): Target {
  const h = href.trim();
  const page = /^(?:\.\/|\.\.\/[a-z]{2}\/)?([a-z0-9-]+)(?:\.md)?(?:#.*)?$/.exec(h);
  if (page) return { kind: 'page', slug: page[1]! };
  return isAllowedLink(h) ? { kind: 'out', href: h } : { kind: 'none' };
}

/** A picture is `shot:name`, a screenshot the tests make (docs/dev/manual.md); nothing else is drawn. */
export function shotName(src: string): string | null {
  const m = /^shot:([a-z0-9-]+)$/.exec(src.trim());
  return m ? m[1]! : null;
}
