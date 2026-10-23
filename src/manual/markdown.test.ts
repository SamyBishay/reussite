import { describe, expect, it } from 'vitest';
import { classifyHref, parseInline, parseMarkdown, plain, shotName, titleOf } from './markdown';

describe('the manual’s Markdown', () => {
  it('reads headings, paragraphs, lists and quotes', () => {
    const b = parseMarkdown('# Title\n\nOne line\nand another.\n\n- a\n- b\n  more\n\n1. x\n2. y\n\n> quote\n\n---\n');
    expect(b.map(x => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'hr']);
    expect(titleOf(b)).toBe('Title');
    expect(plain((b[1] as unknown as { c: never[] }).c)).toBe('One line and another.');
    expect((b[2] as unknown as { items: unknown[] }).items).toHaveLength(2);
    expect(plain((b[2] as unknown as { items: never[][] }).items[1]!)).toBe('b more');
  });
  it('reads bold, italic, code, links and pictures, and never HTML', () => {
    const i = parseInline('**Research says:** *untested* `x` [a](b.md) ![alt](shot:home) <b>no</b>');
    expect(i.map(x => x.t)).toEqual(['b', 'text', 'i', 'text', 'code', 'text', 'a', 'text', 'img', 'text']);
    expect(plain(i)).toContain('<b>no</b>');
  });
  it('does not take a snake_case word or a lone star for emphasis', () => {
    expect(parseInline('a_b_c and 2 * 3 * 4')).toEqual([{ t: 'text', v: 'a_b_c and 2 * 3 * 4' }]);
  });
  it('sends a link to a page, out, or nowhere', () => {
    expect(classifyHref('home.md')).toEqual({ kind: 'page', slug: 'home' });
    expect(classifyHref('./daily-loop')).toEqual({ kind: 'page', slug: 'daily-loop' });
    expect(classifyHref('../en/faq.md#x')).toEqual({ kind: 'page', slug: 'faq' });
    expect(classifyHref('https://example.com/a')).toEqual({ kind: 'out', href: 'https://example.com/a' });
    expect(classifyHref('mailto:a@b.c').kind).toBe('out');
    expect(classifyHref('javascript:alert(1)').kind).toBe('none');
    expect(classifyHref('data:text/html,x').kind).toBe('none');
    expect(classifyHref('file:///etc/passwd').kind).toBe('none');
  });
  it('draws only the pictures the tests make', () => {
    expect(shotName('shot:home')).toBe('home');
    expect(shotName('https://example.com/x.png')).toBeNull();
    expect(shotName('shot:../x')).toBeNull();
  });
});
