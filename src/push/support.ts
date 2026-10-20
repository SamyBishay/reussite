// Where this device stands on notifications, as one word the settings can switch on. Pure: the
// app reads the browser and passes the facts in.

export type PushState =
  | 'hidden' // this build has no VAPID key: the feature isn't offered
  | 'unsupported' // the browser can't do Web Push
  | 'install' // iPhone/iPad in Safari: push exists only for a Home Screen app
  | 'norelay' // there is no relay address to hand the schedule to
  | 'default' // can be switched on: permission will be asked from the tap
  | 'granted'
  | 'denied';

export interface PushFacts {
  hasKey: boolean;
  hasRelay: boolean;
  /** serviceWorker, PushManager and Notification are all there. */
  capable: boolean;
  ios: boolean;
  /** Running as an installed app (display-mode: standalone, or navigator.standalone on iOS). */
  standalone: boolean;
  permission: 'default' | 'granted' | 'denied';
}

export function pushSupport(f: PushFacts): PushState {
  if (!f.hasKey) return 'hidden';
  // On iOS the push API only appears once the page is a Home Screen app, so ask for the install first.
  if (f.ios && !f.standalone) return 'install';
  if (!f.capable) return 'unsupported';
  if (!f.hasRelay) return 'norelay';
  return f.permission;
}

/** iPhone, iPad, and iPadOS posing as a Mac (it has touch points; a Mac does not). */
export function isIos(ua: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}
