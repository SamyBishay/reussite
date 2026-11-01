// The "Next steps" card on Home (S9): what first-run setup no longer asks, one line each, each opening its Settings section.
// Pure: the app reads its state and passes the facts in. A line that is done is not listed; with none left the card is not shown.

export type NextStep = 'key' | 'sync' | 'notify' | 'addresses' | 'connector';

export interface NextFacts {
  /** The build has a relay address, so sync can be switched on. */
  relay: boolean;
  syncOn: boolean;
  /** Sync is on and the recovery key has not been confirmed as saved. */
  keyUnsaved: boolean;
  /** Notifications are offered here and can be switched on (not hidden, not already on). */
  canNotify: boolean;
  addressesOn: boolean;
  /** The person chose the connector path in setup (their AI chat app), to be connected for good. */
  wantsConnector: boolean;
  connectorOn: boolean;
}

/** The lines to show, in order. The recovery key comes first when there is one to save, and replaces the offer of sync. */
export function nextSteps(f: NextFacts): NextStep[] {
  const out: NextStep[] = [];
  if (f.syncOn && f.keyUnsaved) out.push('key');
  else if (!f.syncOn && f.relay) out.push('sync');
  if (f.canNotify) out.push('notify');
  if (f.addressesOn) out.push('addresses');
  if (f.wantsConnector && !f.connectorOn) out.push('connector');
  return out;
}

/** The Settings section (its `data-testid`) each line opens. */
export const SECTION: Record<NextStep, string> = { key: 'sync', sync: 'sync', notify: 'notify', addresses: 'addresses-settings', connector: 'connector' };
