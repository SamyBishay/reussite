// Reading a place from a Google Maps or Apple Maps link (brief §5, Addresses): what the link itself says, and
// nothing else. No network, no geocoding. A short link (maps.app.goo.gl, goo.gl/maps) says nothing, so the
// answer is null and the screen asks for the name.

export interface MapsPlace {
  name: string;
  lat: number | null;
  lng: number | null;
  /** A street address, when the link carries one (Apple's `address=`). */
  street: string | null;
}

/** A link that comes from one of the two Maps apps (short links included). */
export function isMapsLink(url: string): boolean {
  const u = parse(url);
  return !!u && (isGoogle(u) || isApple(u) || isShort(u));
}

/** The first web address in some pasted text (a share sheet may put a line of text before it). */
export function urlIn(text: string): string | null {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text);
  return m ? m[0].replace(/[.,;:!?)\]]+$/, '') : null;
}

/**
 * The place a Maps link names, or null when the link has no name (a short link, a pin with only coordinates,
 * a route). Coordinates come with it when they are plainly there.
 */
export function readMapsLink(url: string): MapsPlace | null {
  const u = parse(url);
  if (!u) return null;
  if (isGoogle(u)) return google(u);
  if (isApple(u)) return apple(u);
  return null;
}

/**
 * Pasted text from a share sheet: the link, and, when the link itself has no name, the first line of text
 * around it if there is one ("Café de Flore" above a short link). Null when there is no Maps link or no name.
 */
export function readShared(text: string): { url: string; place: MapsPlace } | null {
  const url = urlIn(text);
  if (!url || !isMapsLink(url)) return null;
  const read = readMapsLink(url);
  if (read) return { url, place: read };
  const line = text.replace(url, '\n').split(/\r?\n/).map(l => l.trim()).find(l => l && l.length <= 80);
  return line ? { url, place: { name: line, lat: null, lng: null, street: null } } : null;
}

function parse(url: string): URL | null {
  const s = url.trim();
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { return null; }
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
const isGoogle = (u: URL) => /^(google\.[a-z.]+|maps\.google\.[a-z.]+)$/.test(host(u)) && (host(u).startsWith('maps.') || u.pathname.startsWith('/maps'));
const isApple = (u: URL) => host(u) === 'maps.apple.com' || host(u) === 'maps.apple';
const isShort = (u: URL) => host(u) === 'maps.app.goo.gl' || (host(u) === 'goo.gl' && u.pathname.startsWith('/maps'));

/** "+" is a space and %XX is a byte; a malformed escape leaves the text as it is. */
function decode(s: string): string {
  const spaced = s.replace(/\+/g, ' ');
  try { return decodeURIComponent(spaced).trim(); } catch { return spaced.trim(); }
}

const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
function coords(s: string | null | undefined): { lat: number; lng: number } | null {
  const m = s ? COORDS.exec(s) : null;
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const place = (name: string, c: { lat: number; lng: number } | null, street: string | null = null): MapsPlace | null =>
  name ? { name, lat: c?.lat ?? null, lng: c?.lng ?? null, street } : null;

function google(u: URL): MapsPlace | null {
  const path = u.pathname;
  // The pin (!3d…!4d…) is the place; the "@lat,lng" is only where the map was centred.
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
  const c = pin ? { lat: Number(pin[1]), lng: Number(pin[2]) } : at ? { lat: Number(at[1]), lng: Number(at[2]) } : coords(u.searchParams.get('ll'));
  const seg = /^\/maps\/(?:place|search)\/([^/@]+)/.exec(path);
  if (seg) {
    const name = decode(seg[1]!);
    return coords(name) ? null : place(name, c);
  }
  // ?q=Name, ?query=Name (maps/search/?api=1&query=…): a bare pair of numbers is a pin, not a name.
  const q = u.searchParams.get('q') ?? u.searchParams.get('query');
  if (q) return coords(q) ? null : place(decode(q), c);
  return null;
}

function apple(u: URL): MapsPlace | null {
  const p = u.searchParams;
  const c = coords(p.get('coordinate')) ?? coords(p.get('ll')) ?? coords(p.get('sll'));
  const address = (p.get('address') ?? '').trim() || null;
  const name = (p.get('name') ?? p.get('q') ?? '').trim();
  if (name && !coords(name)) return place(name, c, address);
  // Only an address: its first line stands in for the name, the whole of it is kept as the street.
  return address ? place(address.split(',')[0]!.trim(), c, address) : null;
}
