import { describe, expect, it } from 'vitest';
import { isEmail, phoneDigits, reachKind, reachLink, reachOptions } from './reach';
import { isAllowedLink } from './links';

describe('phoneDigits', () => {
  it('keeps a plus and the digits, and turns 00 into a plus', () => {
    expect(phoneDigits('+44 20 7946 0000')).toBe('+442079460000');
    expect(phoneDigits('0044 (20) 7946-0000')).toBe('+442079460000');
    expect(phoneDigits('06 12 34 56 78')).toBe('0612345678');
  });
  it('refuses what is not a number', () => {
    expect(phoneDigits('call me')).toBeNull();
    expect(phoneDigits('12')).toBeNull();
    expect(phoneDigits('1234567890123456789')).toBeNull();
    expect(phoneDigits('https://example.com/123456')).toBeNull();
  });
});

describe('reachOptions', () => {
  it('offers WhatsApp only with a country code, Messages and the phone always', () => {
    expect(reachOptions('+33 6 12 34 56 78').map(o => o.kind)).toEqual(['whatsapp', 'sms', 'tel']);
    expect(reachOptions('+33 6 12 34 56 78')[0]!.link).toBe('https://wa.me/33612345678');
    expect(reachOptions('06 12 34 56 78').map(o => o.kind)).toEqual(['sms', 'tel']);
  });
  it('turns an email into mailto and nothing else into nothing', () => {
    expect(reachOptions(' alex@example.org ')).toEqual([{ kind: 'mail', link: 'mailto:alex@example.org' }]);
    expect(reachOptions('Alex')).toEqual([]);
  });
  it('only gives links the app opens', () => {
    for (const o of [...reachOptions('+33612345678'), ...reachOptions('a@b.co')]) expect(isAllowedLink(o.link)).toBe(true);
  });
});

describe('reachLink', () => {
  it('keeps an allowed link, converts an email, refuses the rest', () => {
    expect(reachLink('https://wa.me/33612345678')).toBe('https://wa.me/33612345678');
    expect(reachLink('whatsapp://send?phone=33612345678')).toBe('whatsapp://send?phone=33612345678');
    expect(reachLink('alex@example.org')).toBe('mailto:alex@example.org');
    expect(reachLink('javascript:alert(1)')).toBeNull();
    expect(reachLink('0612345678')).toBeNull();
    expect(reachLink('  ')).toBeNull();
  });
  it('knows an email', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
  });
});

describe('reachKind', () => {
  it('names the app a link opens', () => {
    expect(reachKind('https://wa.me/1')).toBe('whatsapp');
    expect(reachKind('sms:+1')).toBe('sms');
    expect(reachKind('mailto:a@b.co')).toBe('mail');
    expect(reachKind('tel:+1')).toBe('tel');
    expect(reachKind('signal://x')).toBe('other');
  });
});
