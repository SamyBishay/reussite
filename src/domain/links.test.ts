import { describe, expect, it } from 'vitest';
import { isAllowedLink, resolveLink } from './links';

const iosApp = { ios: true, standalone: true, mobile: true };
const iosSafari = { ios: true, standalone: false, mobile: true };
const desktop = { ios: false, standalone: false, mobile: false };

describe('links', () => {
  it('refuses dangerous schemes', () => {
    expect(isAllowedLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedLink('JavaScript:alert(1)')).toBe(false);
    expect(isAllowedLink('data:text/html,hi')).toBe(false);
    expect(isAllowedLink('http://insecure.example')).toBe(false);
    expect(isAllowedLink('https://doctolib.fr')).toBe(true);
    expect(isAllowedLink('mailto:a@b.c')).toBe(true);
    expect(isAllowedLink('whatsapp://send?phone=1')).toBe(true);
  });
  it('opens websites in Safari from the Home Screen app on iOS', () => {
    expect(resolveLink({ link: 'https://doctolib.fr/x' }, iosApp)?.href).toBe('x-safari-https://doctolib.fr/x');
    expect(resolveLink({ link: 'https://doctolib.fr/x' }, iosSafari)?.href).toBe('https://doctolib.fr/x');
    expect(resolveLink({ link: 'https://doctolib.fr/x' }, desktop)?.href).toBe('https://doctolib.fr/x');
    expect(resolveLink({ link: 'https://doctolib.fr/x' }, iosApp, true)?.href).toBe('https://doctolib.fr/x');
  });
  it('opens apps by their scheme', () => {
    expect(resolveLink({ app: 'Mail' }, iosApp)?.href).toBe('mailto:');
    expect(resolveLink({ app: 'WhatsApp' }, desktop)?.href).toBe('https://web.whatsapp.com/');
    expect(resolveLink({ app: 'Unknown' }, iosApp)).toBeNull();
  });
  it('sends prompts to the Claude app on phones and claude.ai on desktop', () => {
    expect(resolveLink({ prompt: 'x', link: 'https://claude.ai/new' }, iosApp)?.href).toBe('claude://');
    expect(resolveLink({ prompt: 'x' }, desktop)?.href).toBe('https://claude.ai/new');
  });
  it('drops a refused link', () => {
    expect(resolveLink({ link: 'javascript:alert(1)' }, desktop)).toBeNull();
  });
});
