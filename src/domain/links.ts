// Opening a step's app or website (brief §5): apps by their own URL scheme, websites in the
// default browser, never a page inside Réussite. Keep the table of known apps here.

/** Schemes a link may use. Anything else (javascript:, data:, file:…) is refused. */
export const ALLOWED_SCHEMES = new Set([
  'https:', 'mailto:', 'sms:', 'tel:', 'facetime:', 'facetime-audio:', 'maps:', 'whatsapp:', 'claude:', 'tg:', 'signal:',
  'spotify:', 'shortcuts:', 'x-safari-https:', 'comgooglemaps:', 'googlegmail:', 'ms-outlook:', 'slack:', 'zoomus:', 'notion:', 'obsidian:', 'webcal:',
]);

/** Apps a step can name, with the URL that opens them when the step has no link of its own. */
export const KNOWN_APPS: Record<string, { open: string; web?: string }> = {
  mail: { open: 'mailto:' },
  messages: { open: 'sms:' },
  phone: { open: 'tel:' },
  whatsapp: { open: 'whatsapp://', web: 'https://web.whatsapp.com/' },
  claude: { open: 'claude://', web: 'https://claude.ai/new' },
  maps: { open: 'maps://', web: 'https://maps.apple.com/' },
  'google maps': { open: 'comgooglemaps://', web: 'https://maps.google.com/' },
  gmail: { open: 'googlegmail://', web: 'https://mail.google.com/' },
  outlook: { open: 'ms-outlook://', web: 'https://outlook.live.com/' },
  spotify: { open: 'spotify:', web: 'https://open.spotify.com/' },
  shortcuts: { open: 'shortcuts://' },
  telegram: { open: 'tg://', web: 'https://web.telegram.org/' },
  signal: { open: 'sgnl://' },
  slack: { open: 'slack://', web: 'https://app.slack.com/' },
  notion: { open: 'notion://', web: 'https://www.notion.so/' },
  obsidian: { open: 'obsidian://' },
};
ALLOWED_SCHEMES.add('sgnl:');

export function schemeOf(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*:)/i.exec(url.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export function isAllowedLink(url: string | null | undefined): boolean {
  if (!url) return false;
  const s = schemeOf(url);
  if (!s || !ALLOWED_SCHEMES.has(s)) return false;
  if (s === 'https:') { try { new URL(url); } catch { return false; } }
  return true;
}

export interface Platform { ios: boolean; standalone: boolean; mobile: boolean }

/** Just what detectPlatform reads, so this file also compiles where there is no DOM (the relay Worker). */
interface NavLike { userAgent: string; maxTouchPoints?: number; standalone?: boolean }
interface WinLike { matchMedia?(query: string): { matches: boolean } }

export function detectPlatform(nav: NavLike = (globalThis as unknown as { navigator: NavLike }).navigator, win: WinLike = globalThis as unknown as WinLike): Platform {
  const ua = nav.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && (nav.maxTouchPoints ?? 0) > 1);
  const standalone = win.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
  return { ios, standalone: !!standalone, mobile: ios || /Android/i.test(ua) };
}

export interface LinkTarget { href: string; external: boolean }

/**
 * What a step's button should open. Websites get `x-safari-https://` when running as a Home
 * Screen app on iOS, so they open in Safari instead of an in-app sheet; `inApp` turns that off.
 */
export function resolveLink(step: { app?: string | null; link?: string | null; prompt?: string | null }, p: Platform, inApp = false): LinkTarget | null {
  let href = step.link && isAllowedLink(step.link) ? step.link.trim() : null;
  const app = step.app ? KNOWN_APPS[step.app.trim().toLowerCase()] : undefined;
  if (step.prompt && (!href || /^https:\/\/claude\.ai\/?(new)?$/i.test(href))) href = p.mobile ? 'claude://' : 'https://claude.ai/new';
  if (!href && app) href = p.mobile || !app.web ? app.open : app.web;
  if (!href) return null;
  if (!inApp && p.ios && p.standalone && schemeOf(href) === 'https:') href = 'x-safari-' + href;
  return { href, external: !inApp };
}
