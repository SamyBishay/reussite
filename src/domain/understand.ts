// Settings → "How Réussite understands you": the choice (on this device, or a cloud AI) and the one status list under it that answers
// "is it all linked?". Pure: the app reads its state and passes the facts in.

export type Mode = 'device' | 'cloud';

/** What the screen shows as chosen: what the person tapped last, else a cloud AI when a provider or the connector is on, else this device. */
export function modeOf(f: { provider: string; connectorOn: boolean; picked: Mode | null }): Mode {
  if (f.picked) return f.picked;
  return f.provider !== 'none' || f.connectorOn ? 'cloud' : 'device';
}

export type LineId = 'sync' | 'recovery' | 'connector' | 'chatApp' | 'key';
/** Where a line that is not done takes the person: a piece of the same screen, by its `data-testid`, or the recovery key's sheet. */
export type Target = 'sync' | 'show-key' | 'connector' | 'ai-settings';

export interface StatusFacts {
  /** The build has a sync server address. */
  relay: boolean;
  syncOn: boolean;
  keySaved: boolean;
  /** The connector's state as the relay last said it; null while unknown (sync off, or not asked yet). */
  connectorOn: boolean | null;
  /** When an AI chat app last used the connector (ms), or null. */
  lastUsed: number | null;
  provider: string;
  /** A key for the provider is stored on this device. */
  hasKey: boolean;
  /** The last connection test: passed, failed, or not run since the key or provider changed. */
  keyTest: 'ok' | 'failed' | null;
}

export interface StatusLine {
  id: LineId;
  /** Which sentence says it (the screen picks the words). */
  state: 'on' | 'off' | 'saved' | 'unsaved' | 'none' | 'seen' | 'never' | 'works' | 'failed' | 'untested' | 'noKey' | 'unknown';
  done: boolean;
  /** Where a tap goes; absent when the line is done or nothing on this screen can do it. */
  go?: Target;
}

/** The five lines, in order: sync, its recovery key, the connector, the chat app last seen, the key works. */
export function statusLines(f: StatusFacts): StatusLine[] {
  const out: StatusLine[] = [];
  out.push(f.syncOn ? { id: 'sync', state: 'on', done: true } : { id: 'sync', state: 'off', done: false, ...(f.relay ? { go: 'sync' as const } : {}) });
  out.push(!f.syncOn ? { id: 'recovery', state: 'none', done: false, ...(f.relay ? { go: 'sync' as const } : {}) }
    : f.keySaved ? { id: 'recovery', state: 'saved', done: true } : { id: 'recovery', state: 'unsaved', done: false, go: 'show-key' });
  const on = f.connectorOn === true;
  out.push(on ? { id: 'connector', state: 'on', done: true }
    : f.syncOn && f.connectorOn === null ? { id: 'connector', state: 'unknown', done: false, go: 'connector' }
      : { id: 'connector', state: 'off', done: false, go: 'connector' });
  out.push(on && f.lastUsed ? { id: 'chatApp', state: 'seen', done: true } : { id: 'chatApp', state: 'never', done: false, go: 'connector' });
  out.push(f.provider === 'none' || !f.hasKey ? { id: 'key', state: 'noKey', done: false, go: 'ai-settings' }
    : f.keyTest === 'ok' ? { id: 'key', state: 'works', done: true }
      : { id: 'key', state: f.keyTest === 'failed' ? 'failed' : 'untested', done: false, go: 'ai-settings' });
  return out;
}
