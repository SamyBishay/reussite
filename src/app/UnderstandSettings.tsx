// Settings → How Réussite understands you: the one place for the choice between On this device (the default: Home's parser reads the lines, nothing
// leaves the device) and A cloud AI, with its two ways, each of which can be on: My own key and My AI chat app through the connector. Composed from
// the existing pieces (the key's panel, src/ai/AiSettings.tsx, and the connector's, ./ConnectorSettings.tsx), which keep their own controls here, so
// a change is made where the person is looking. Under the choice, one status list answers "is it all linked?"; each line that is not done opens or
// scrolls to the piece that does it (sync is its own section, just below on the same screen). The rules are in src/domain/understand.ts.
import { useEffect, useState } from 'preact/hooks';
import { settings, saveSettings } from './store';
import { connector, keySaved, relayBase, syncOn } from './sync';
import { openShowKey } from './SyncSettings';
import { ConnectorPanel, openConnectorOff } from './ConnectorSettings';
import { AiKeyPanel, keyTest } from '../ai/AiSettings';
import { aiOn } from '../ai/ask';
import { Fold, reveal } from './More';
import { modeOf, statusLines, type Mode, type StatusLine, type Target } from '../domain/understand';
import { t, locale, type Key } from '../i18n';

const when = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

const TEXT: Record<StatusLine['id'], Partial<Record<StatusLine['state'], Key>>> = {
  sync: { on: 'uStSyncOn', off: 'uStSyncOff' },
  recovery: { saved: 'uStKeySaved', unsaved: 'uStKeyUnsaved', none: 'uStKeyNone' },
  connector: { on: 'uStConnOn', off: 'uStConnOff', unknown: 'uStConnUnknown' },
  chatApp: { seen: 'uStAppSeen', never: 'uStAppNever' },
  key: { works: 'uStAiWorks', failed: 'uStAiFailed', untested: 'uStAiUntested', noKey: 'uStAiNone' },
};

/** Where a line goes: the recovery key's sheet, or a piece of this screen (for the chat app, the connector's steps and pairing code too). */
function goTo(target: Target, line: StatusLine['id']) {
  if (target === 'show-key') { openShowKey(); return; }
  if (target === 'connector' && line === 'chatApp' && connector.value?.on) reveal('connector-more', false);
  reveal(target);
}

function Status() {
  const st = connector.value;
  const lines = statusLines({
    relay: !!relayBase(), syncOn: syncOn.value, keySaved: keySaved.value, connectorOn: syncOn.value ? (st ? st.on : null) : false,
    lastUsed: st?.lastUsed ?? null, provider: settings.value.aiProvider, hasKey: aiOn.value, keyTest: keyTest.value ? (keyTest.value.ok ? 'ok' : 'failed') : null,
  });
  return (
    <div class="field" data-testid="understand-status"><span>{t('uStTitle')}</span>
      <ul class="ustatus">
        {lines.map(l => {
          const text = t(TEXT[l.id][l.state]!, { when: st?.lastUsed ? when(st.lastUsed) : '' });
          return (
            <li data-testid={'ust-' + l.id} data-done={l.done ? 'yes' : 'no'}>
              <span class={l.done ? 'ust-mark done' : 'ust-mark'} aria-hidden="true">{l.done ? '✓' : '○'}</span>
              {l.go ? <button type="button" class="linklike" onClick={() => goTo(l.go!, l.id)} data-testid={'ust-go-' + l.id}>{text}</button> : <span>{text}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function UnderstandSettings() {
  const p = settings.value.aiProvider;
  const st = connector.value;
  const [picked, setPicked] = useState<Mode | null>(null);
  // Choosing a provider is choosing a cloud AI.
  useEffect(() => { if (p !== 'none') setPicked(null); }, [p]);
  const mode = modeOf({ provider: p, connectorOn: !!st?.on, picked });
  // On this device sets the provider to none. The connector keeps its own switch: switching it off signs every chat app out, so it is never done here.
  const device = () => { setPicked('device'); if (p !== 'none') void saveSettings({ aiProvider: 'none' }); };
  const cloud = () => { setPicked('cloud'); reveal('understand-ways', false); };
  return (
    <Fold title={t('uTitle')} testid="understand">
      <p class="hint">{t('uIntro')}</p>
      <div class="bigchoices uchoice" role="group" aria-label={t('uTitle')}>
        <button type="button" class="btn" aria-pressed={mode === 'device'} onClick={device} data-testid="ai-none"><b>{t('uDevice')}</b><small>{t('uDeviceHint')}</small></button>
        <button type="button" class="btn" aria-pressed={mode === 'cloud'} onClick={cloud} data-testid="understand-cloud"><b>{t('uCloud')}</b><small>{t('uCloudHint')}</small></button>
      </div>
      {mode === 'device' && st?.on && (
        <div class="banner" data-testid="understand-connector-stays" role="status">
          <p>{t('uConnectorStays')}</p>
          <div class="go"><button class="btn small" type="button" onClick={() => openConnectorOff()} data-testid="understand-connector-off">{t('uConnectorOff')}</button></div>
        </div>
      )}
      <Status />
      <div class="uways" data-testid="understand-ways">
        <h3 class="uways-h">{t('uWaysTitle')}</h3>
        <section class="uway" data-testid="way-key" aria-labelledby="way-key-h">
          <h4 id="way-key-h">{t('uKey')} <span class="hint ustate" data-testid="way-key-state">{aiOn.value ? t('uWayOn') : t('uWayOff')}</span></h4>
          <p class="hint">{t('uKeyDay')}</p>
          <p class="hint">{t('uKeyCost')}</p>
          <AiKeyPanel />
        </section>
        <section class="uway" data-testid="way-connector" aria-labelledby="way-connector-h">
          <h4 id="way-connector-h">{t('uConnector')} <span class="hint ustate" data-testid="way-connector-state">{st?.on ? t('uWayOn') : t('uWayOff')}</span></h4>
          <p class="hint">{t('uConnectorDay')}</p>
          <p class="hint">{t('uConnectorCost')}</p>
          <ConnectorPanel />
        </section>
      </div>
    </Fold>
  );
}
