// Home's "Next steps" card (S9): what first-run setup no longer asks, one line each, each opening its Settings section. Shown only on
// the device that ran setup, until the person dismisses it; a line that is done goes by itself, and with none left the card is gone.
import { useEffect } from 'preact/hooks';
import { go } from './nav';
import { nextSteps, dismissNextSteps } from './onboarding';
import { syncOn, keySaved, relayBase, connector } from './sync';
import { pushState, pushOn, refreshPushState } from './push';
import { addressesOn } from './model';
import { nextSteps as linesOf, SECTION, type NextStep } from '../domain/nextSteps';
import { t, type Key } from '../i18n';

const TEXT: Record<NextStep, [Key, Key]> = {
  key: ['nextKey', 'nextKeyHint'],
  sync: ['nextSync', 'nextSyncHint'],
  notify: ['nextNotify', 'nextNotifyHint'],
  addresses: ['nextAddresses', 'nextAddressesHint'],
  connector: ['nextConnector', 'nextConnectorHint'],
};

/** Settings, with the section named by its `data-testid` open and in view (a section inside "More" opens its folds too). */
export function openSettingsSection(testid: string): void {
  go('settings');
  let tries = 0;
  const find = () => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    if (!el) { if (tries++ < 30) requestAnimationFrame(find); return; }
    for (let d: HTMLDetailsElement | null = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  requestAnimationFrame(find);
}

export function NextStepsCard() {
  const n = nextSteps.value;
  useEffect(() => { if (n.on) refreshPushState(); }, [n.on]);
  if (!n.on) return null;
  const st = pushState.value;
  const lines = linesOf({
    relay: !!relayBase(),
    syncOn: syncOn.value,
    keyUnsaved: syncOn.value && !keySaved.value,
    canNotify: (st === 'default' || st === 'install' || st === 'granted') && !pushOn.value,
    addressesOn: addressesOn(),
    wantsConnector: n.connector,
    connectorOn: !!connector.value?.on,
  });
  if (!lines.length) return null;
  return (
    <section class="nextsteps" data-testid="next-steps" aria-labelledby="next-steps-h">
      <h2 class="eyebrow" id="next-steps-h">{t('nextTitle')}</h2>
      <p class="hint">{t('nextHint')}</p>
      <ul class="picklist menu">
        {lines.map(l => (
          <li><button type="button" class="linklike" onClick={() => openSettingsSection(SECTION[l])} data-testid={'next-' + l}><b>{t(TEXT[l][0])}</b><small>{t(TEXT[l][1])}</small></button></li>
        ))}
      </ul>
      <div class="actions"><button class="btn small ghost" type="button" onClick={() => void dismissNextSteps()} data-testid="next-dismiss">{t('nextDismiss')}</button></div>
    </section>
  );
}
