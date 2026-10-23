// Settings → Connector (brief §10): let an AI app read and edit the list through the relay.
// Off by default. Switching on hands the relay the list's key, so the privacy cost is said first,
// plainly, and again in the confirmation.
import { useEffect, useState } from 'preact/hooks';
import { toast, readOnly } from './store';
import { openSheet, closeSheet } from './sheet';
import { connector, connectorNewCode, connectorOff, connectorOn, refreshConnector, spaceGone, syncOn } from './sync';
import { RelayError } from '../sync/client';
import { t, locale } from '../i18n';
import { More, Fold, openFold } from './More';

const when = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

const ERR = { connector_unavailable: 'connectorUnavailable', wrong_key: 'connectorWrongKey', rate_limited: 'connectorBusy', network: 'syncNetwork' } as const;
const failure = (e: unknown) => {
  const code = e instanceof RelayError ? e.code : 'error';
  return code in ERR ? t(ERR[code as keyof typeof ERR]) : t('syncFailed', { code });
};

/** The privacy cost, in plain words. Shown in the section and again in the confirmation. */
function Privacy() {
  return (
    <>
      <p>{t('connectorPrivacy1')}</p>
      <p>{t('connectorPrivacy2')}</p>
    </>
  );
}

export interface Code { code: string; expires: number }

function SwitchOnSheet({ done }: { done: (c: Code) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { const c = await connectorOn(); done(c); closeSheet(); toast(t('connectorSwitchedOn')); }
    catch (e) { setErr(failure(e)); setBusy(false); }
  };
  return (
    <div class="flow" data-testid="connector-on-sheet">
      <h3>{t('connectorOnTitle')}</h3>
      <Privacy />
      {err && <p class="err" role="alert" data-testid="connector-error">{err}</p>}
      <div class="actions">
        <button class="btn primary" type="button" disabled={busy} onClick={go} data-testid="connector-on-confirm">{t('connectorOnConfirm')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function SwitchOffSheet({ done }: { done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await connectorOff(); done(); closeSheet(); toast(t('connectorSwitchedOff')); }
    catch (e) { setErr(failure(e)); setBusy(false); }
  };
  return (
    <div class="flow" data-testid="connector-off-sheet">
      <h3>{t('connectorOffTitle')}</h3>
      <p>{t('connectorOffBody')}</p>
      <p class="hint">{t('connectorOffRemains')}</p>
      {err && <p class="err" role="alert" data-testid="connector-error">{err}</p>}
      <div class="actions">
        <button class="btn primary" type="button" disabled={busy} onClick={go} data-testid="connector-off-confirm">{t('connectorOffConfirm')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
}

/** `ABCD-EFGH` in large grouped characters, with the minutes left. */
function PairingCode({ code, onNew, busy }: { code: Code | null; onNew: () => void; busy: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = code ? Math.max(0, Math.ceil((code.expires - now) / 1000)) : 0;
  const live = !!code && left > 0;
  const clock = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  return (
    <div class="field" data-testid="connector-code-box"><span>{t('connectorCodeLabel')}</span>
      {live ? (
        <>
          <p class="paircode mono" data-testid="connector-code" aria-label={code!.code.replace(/-/g, ' ')}>{code!.code.split('-').map(g => <span>{g}</span>)}</p>
          <p class="hint" role="timer" data-testid="connector-expiry">{t('connectorCodeLeft', { time: clock })}</p>
        </>
      ) : <p class="hint" data-testid="connector-no-code">{code ? t('connectorCodeExpired') : t('connectorCodeNone')}</p>}
      <div class="actions"><button class="btn" type="button" disabled={busy || readOnly.value} onClick={onNew} data-testid="connector-new-code">{t('connectorNewCode')}</button></div>
    </div>
  );
}

export function ConnectorSettings() {
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = syncOn.value;
  useEffect(() => { if (on) void refreshConnector().catch(() => undefined); }, [on]);
  const st = connector.value;

  if (!on) return (
    <Fold title={t('connectorSection')} testid="connector">
      <p class="hint">{t('connectorSyncFirst')}</p>
      <div class="actions">
        <button class="btn" type="button" data-testid="connector-to-sync" onClick={() => {
          const el = document.querySelector<HTMLElement>('[data-testid="sync"]');
          openFold(el);
          el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          el?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
        }}>{t('connectorGoSync')}</button>
      </div>
    </Fold>
  );

  const newCode = async () => {
    setBusy(true); setErr('');
    try { setCode(await connectorNewCode()); }
    catch (e) { setErr(failure(e)); if (e instanceof RelayError && e.code === 'connector_off') void refreshConnector().catch(() => undefined); }
    setBusy(false);
  };
  const copyUrl = () => navigator.clipboard?.writeText(st!.url).then(() => toast(t('connectorUrlCopied')), () => undefined);

  return (
    <Fold title={t('connectorSection')} testid="connector">
      {!st ? <p class="hint" role="status">{t('connectorChecking')}</p> : !st.on ? (
        <>
          <p>{t('connectorIntro')}</p>
          <Privacy />
          {err && <p class="err" role="alert">{err}</p>}
          <div class="actions">
            <button class="btn primary" type="button" disabled={readOnly.value || spaceGone.value} data-testid="connector-on"
              onClick={() => openSheet(<SwitchOnSheet key={'co' + Date.now()} done={setCode} />)}>{t('connectorOn')}</button>
          </div>
        </>
      ) : (
        <>
          <p role="status" data-testid="connector-state"><b>{t('connectorIsOn')}</b> {st.lastUsed ? t('connectorLastUsed', { when: when(st.lastUsed) }) : t('connectorNeverUsed')}</p>
          <p class="warnline">{t('connectorPrivacyShort')}</p>
          <div class="field"><span>{t('connectorUrlLabel')}</span>
            <p class="urlbox mono" data-testid="connector-url">{st.url}</p>
            <div class="actions"><button class="btn" type="button" onClick={copyUrl} data-testid="connector-copy-url">{t('connectorCopyUrl')}</button></div>
          </div>
          {err && <p class="err" role="alert" data-testid="connector-error">{err}</p>}
          <More open={!!code} testid="connector-more">
            <ol class="steps-list">
              <li>{t('connectorStep1')}</li>
              <li>{t('connectorStep2')}</li>
              <li>{t('connectorStep3')}</li>
            </ol>
            <p class="hint">{t('connectorOtherApps')}</p>
            <PairingCode code={code} onNew={newCode} busy={busy} />
            <div class="actions">
              <button class="btn" type="button" disabled={readOnly.value} data-testid="connector-off"
                onClick={() => openSheet(<SwitchOffSheet key={'cf' + Date.now()} done={() => setCode(null)} />)}>{t('connectorOff')}</button>
            </div>
          </More>
        </>
      )}
    </Fold>
  );
}
