declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  /** The relay's address, set at build time; a fork sets its own. Empty = sync can't be switched on until one is typed in. */
  readonly VITE_RELAY_URL?: string;
  /** The relay's VAPID public key (base64url, 65 bytes), set at build time. Absent = notifications are hidden. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}
