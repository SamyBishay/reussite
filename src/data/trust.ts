// Where a secret may be sent (docs/dev/sync.md → "Where credentials go"). The relay address and the AI base URL are
// settings, so a restored backup or a synced edit can change them; but the sync bearer and the AI key must only go to
// a destination this device approved. A destination is approved when the person typed it here, when it is the build's
// default, or, for a device that had one before this rule, the first time it started (`firstUse`).
// The approved value lives in the device-local table, which neither a backup nor sync ever carries.

/** A URL as compared: scheme, host and path with no trailing slash, lower-cased host; '' when it isn't a URL. */
export function destination(raw: string): string {
  try {
    const u = new URL(raw.trim());
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch { return ''; }
}

/** This computer: a key sent there leaves nothing (a local relay for testing, a local model). */
const loopback = (d: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(d);

/** The setting may be used with a secret: it is the build's default, or the one approved on this device. */
export function approved(current: string, dflt: string, local: string | null | undefined): boolean {
  const c = destination(current);
  return !!c && (c === destination(dflt) || c === destination(local ?? '') || loopback(c));
}

/** What to keep on first start: the current value, so a device that already works keeps working. Null when there is nothing to keep. */
export function firstUse(current: string, local: string | null | undefined): string | null {
  return local === undefined || local === null ? (destination(current) || null) : null;
}
