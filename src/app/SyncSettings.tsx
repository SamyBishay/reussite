// Settings → Sync & devices (brief §6), the guided set-up and join, and the two quiet cards on
// Today: "save your recovery key" and, with sync off, "save a backup" every two weeks.
import { useEffect, useState } from 'preact/hooks';
import { saveSettings, settings, toast, readOnly, tasks, getClock } from './store';
import { openSheet, closeSheet } from './sheet';
import { QrCode, QrScanner } from './qr';
import { backupDue, backupText, confirmKeySaved, deleteEverywhere, deviceName, devices, joinSync, keySaved, lastSyncAt, probeKey, recoveryKeyText, refreshDevices, relayBase, renameDevice, setupSync, snoozeBackupReminder, spaceGone, syncBusy, syncError, syncNow, syncOn, turnOffSync, defaultDeviceName } from './sync';
import { RecoveryKeyError } from '../sync/keys';
import { RelayError } from '../sync/client';
import { saveFile } from '../data/backup';
import { t, locale, type Key } from '../i18n';

const isoToday = () => new Date().toISOString().slice(0, 10);

/** The key in groups of four, readable and copyable. */
function Groups({ text }: { text: string }) {
  return <p class="keygrid mono" data-testid="recovery-key">{text.split('-').map(g => <><span>{g}</span>{' '}</>)}</p>;
}

/** The key on screen: groups, QR code, copy, and what to do with it. */
function KeyView({ text }: { text: string }) {
  const copy = () => navigator.clipboard?.writeText(text).then(() => toast(t('syncKeyCopied')), () => undefined);
  return (
    <>
      <Groups text={text} />
      <div class="qrbox"><QrCode text={text} label={t('syncKeyQr')} /></div>
      <div class="actions"><button class="btn" type="button" onClick={copy}>{t('syncCopyKey')}</button></div>
      <p class="hint">{t('syncKeySaveHint')}</p>
      <p class="warnline">{t('syncWarning')}</p>
    </>
  );
}

// ---------- first device

function SetUpSheet() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  if (!key) return (
    <div class="flow" data-testid="sync-setup-sheet">
      <h3>{t('syncSetUpTitle')}</h3>
      <p>{t('syncSetUpBody')}</p>
      <p class="warnline">{t('syncWarning')}</p>
      <div class="actions">
        <button class="btn primary" type="button" disabled={busy} data-testid="sync-make-key" onClick={async () => { setBusy(true); setKey(await setupSync()); }}>{t('syncMakeKey')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
  return (
    <div class="flow" data-testid="sync-key-sheet">
      <h3>{t('syncYourKey')}</h3>
      <KeyView text={key} />
      <div class="actions">
        <button class="btn primary" type="button" data-testid="sync-key-saved" onClick={async () => { await confirmKeySaved(); closeSheet(); }}>{t('syncKeySavedBtn')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('syncKeyLater')}</button>
      </div>
    </div>
  );
}

/** Show recovery key, behind a tap; also what the Today card opens. */
export function openShowKey() {
  openSheet(<ShowKeySheet key={'sk' + Date.now()} />);
}
function ShowKeySheet() {
  return (
    <div class="flow" data-testid="sync-show-key">
      <h3>{t('syncYourKey')}</h3>
      <KeyView text={recoveryKeyText()} />
      <div class="actions">
        {!keySaved.value && <button class="btn primary" type="button" onClick={async () => { await confirmKeySaved(); closeSheet(); }}>{t('syncKeySavedBtn')}</button>}
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('close')}</button>
      </div>
    </div>
  );
}

// ---------- another device

const KEY_ERR: Record<string, Key> = { length: 'keyErrLength', char: 'keyErrChar', checksum: 'keyErrChecksum' };

function JoinSheet() {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [empty, setEmpty] = useState<Awaited<ReturnType<typeof probeKey>> | null>(null);

  const check = async (value = text) => {
    setErr(''); setBusy(true);
    try {
      const p = await probeKey(value);
      if (p.empty) setEmpty(p); else await go(p.recovery);
    } catch (e) {
      setErr(e instanceof RecoveryKeyError ? t(KEY_ERR[e.code]!) : e instanceof RelayError && e.code === 'network' ? t('syncNetwork') : t('syncFailed', { code: e instanceof RelayError ? e.code : 'error' }));
    }
    setBusy(false);
  };
  const go = async (recovery: Uint8Array<ArrayBuffer>) => { await joinSync(recovery); closeSheet(); toast(t('syncJoining')); };

  if (empty) return (
    <div class="flow" data-testid="sync-empty">
      <h3>{t('syncEmptyTitle')}</h3>
      <p>{t('syncEmptyBody')}</p>
      <div class="actions">
        <button class="btn primary" type="button" onClick={() => setEmpty(null)} data-testid="sync-empty-back">{t('syncBack')}</button>
        <button class="btn" type="button" onClick={() => void go(empty.recovery)} data-testid="sync-empty-go">{t('syncEmptyGoOn')}</button>
      </div>
    </div>
  );
  return (
    <div class="flow" data-testid="sync-join-sheet">
      <h3>{t('syncJoinTitle')}</h3>
      <p>{t('syncJoinBody')}</p>
      {scan ? <QrScanner onCancel={() => setScan(false)} onText={v => { setScan(false); setText(v); void check(v); }} /> : (
        <>
          <label class="field"><span>{t('syncKeyField')}</span>
            <textarea rows={3} value={text} autocomplete="off" autocapitalize="characters" spellcheck={false} class="mono" data-testid="sync-join-key"
              onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
          </label>
          {err && <p class="err" role="alert" data-testid="sync-join-error">{err}</p>}
          <div class="actions">
            <button class="btn primary" type="button" disabled={busy || !text.trim() || !relayBase()} onClick={() => void check()} data-testid="sync-join-go">{busy ? t('syncChecking') : t('syncContinue')}</button>
            <button class="btn" type="button" onClick={() => setScan(true)} data-testid="sync-scan">{t('syncScan')}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- turn off, delete

function TurnOffSheet() {
  const [ok, setOk] = useState(false);
  return (
    <div class="flow" data-testid="sync-off-sheet">
      <h3>{t('syncTurnOff')}</h3>
      <p>{t('syncTurnOffBody')}</p>
      <label class="tog"><input type="checkbox" checked={ok} onChange={e => setOk((e.target as HTMLInputElement).checked)} data-testid="sync-off-saved" /> {t('syncTurnOffSaved')}</label>
      <div class="actions">
        <button class="btn primary" type="button" disabled={!ok} data-testid="sync-off-confirm" onClick={async () => { await turnOffSync(); closeSheet(); toast(t('syncTurnedOff')); }}>{t('syncTurnOffConfirm')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function DeleteSheet() {
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const word = t('syncDeleteWord');
  const go = async () => {
    try { await deleteEverywhere(); closeSheet(); toast(t('syncDeleted')); }
    catch (e) { setErr(t('syncFailed', { code: e instanceof RelayError ? e.code : 'error' })); }
  };
  return (
    <div class="flow" data-testid="sync-delete-sheet">
      <h3>{t('syncDelete')}</h3>
      <p>{t('syncDeleteBody')}</p>
      <label class="field"><span>{t('syncDeleteType', { word })}</span>
        <input type="text" value={typed} autocomplete="off" autocapitalize="off" spellcheck={false} onInput={e => setTyped((e.target as HTMLInputElement).value)} data-testid="sync-delete-word" />
      </label>
      {err && <p class="err" role="alert">{err}</p>}
      <div class="actions">
        <button class="btn primary" type="button" disabled={typed.trim().toLowerCase() !== word.toLowerCase()} data-testid="sync-delete-confirm" onClick={go}>{t('syncDeleteConfirm')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
}

// ---------- the settings section

const when = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

function Status() {
  const at = lastSyncAt.value;
  let msg: string;
  if (readOnly.value) msg = t('syncReadOnly');
  else if (spaceGone.value) msg = t('syncStatusPaused');
  else if (syncError.value && !syncBusy.value) msg = t('syncStatusRetry', { code: syncError.value });
  else if (syncBusy.value && !at) msg = t('syncStatusBusy');
  else if (!at) msg = t('syncStatusNever');
  else {
    const d = new Date(at), same = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    msg = same ? t('syncStatusAt', { time }) : t('syncStatusAtDay', { day: d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }), time });
  }
  const bad = readOnly.value || spaceGone.value || (!!syncError.value && !syncBusy.value);
  return <p class={bad ? 'err' : 'hint'} role="status" data-testid="sync-status">{msg}</p>;
}

function Devices() {
  const [name, setName] = useState(deviceName.value || defaultDeviceName());
  useEffect(() => { void refreshDevices().catch(() => undefined); }, []);
  const list = devices.value;
  return (
    <div class="field" data-testid="sync-devices"><span>{t('syncDevices')}</span>
      <label class="field" style="margin-top:0"><span>{t('syncDeviceName')}</span>
        <div class="addplace">
          <input type="text" value={name} maxLength={40} onInput={e => setName((e.target as HTMLInputElement).value)} data-testid="sync-device-name" />
          <button class="btn" type="button" onClick={async () => { await renameDevice(name); toast(t('syncRename')); }}>{t('syncRename')}</button>
        </div>
      </label>
      {list && list.length ? (
        <ul class="devlist">
          {list.map(d => <li><b>{d.name ?? '—'}</b>{d.device === getClock().node ? ' · ' + t('syncThisDevice') : ''} <small class="hint">{t('syncLastSeen', { when: when(d.lastSeen) })}</small></li>)}
        </ul>
      ) : <p class="hint">{t('syncNoDevices')}</p>}
    </div>
  );
}

export function SyncSettings() {
  const s = settings.value;
  const base = relayBase();
  return (
    <section class="set" data-testid="sync">
      <h2>{t('syncSection')}</h2>
      {!syncOn.value ? (
        <>
          <p class="hint">{t('syncIntro')}</p>
          {!base && <p class="err" data-testid="sync-no-relay">{s.relayUrl.trim() ? t('syncRelayBad') : t('syncNoRelay')}</p>}
          <div class="actions">
            <button class="btn primary" type="button" disabled={!base || readOnly.value} onClick={() => openSheet(<SetUpSheet key={'su' + Date.now()} />, true)} data-testid="sync-setup">{t('syncSetUp')}</button>
            <button class="btn" type="button" disabled={!base || readOnly.value} onClick={() => openSheet(<JoinSheet key={'sj' + Date.now()} />, true)} data-testid="sync-join">{t('syncJoin')}</button>
          </div>
          <details class="more" open={!base}><summary>{t('syncRelayLabel')}</summary>
            <label class="field"><span>{t('syncRelayLabel')}</span>
              <input type="url" inputMode="url" value={s.relayUrl} autocomplete="off" spellcheck={false} data-testid="sync-relay"
                onChange={e => void saveSettings({ relayUrl: (e.target as HTMLInputElement).value.trim() })} />
              <small class="hint">{t('syncRelayHint')}</small>
            </label>
          </details>
        </>
      ) : (
        <>
          <Status />
          {!keySaved.value && (
            <div class="banner warn"><p>{t('syncKeyCardBody')}</p><button class="btn" type="button" onClick={openShowKey}>{t('syncShowKeyBtn')}</button></div>
          )}
          <div class="actions">
            <button class="btn" type="button" disabled={syncBusy.value || readOnly.value || spaceGone.value} onClick={() => void syncNow()} data-testid="sync-now">{t('syncNow')}</button>
            <button class="btn" type="button" onClick={openShowKey} data-testid="sync-show-key-btn">{t('syncShowKey')}</button>
          </div>
          {!spaceGone.value && <Devices />}
          <div class="actions">
            <button class="btn" type="button" onClick={() => openSheet(<TurnOffSheet key={'to' + Date.now()} />)} data-testid="sync-off">{t('syncTurnOff')}</button>
            <button class="btn ghost" type="button" onClick={() => openSheet(<DeleteSheet key={'dl' + Date.now()} />)} data-testid="sync-delete">{t('syncDelete')}</button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- cards on Today

/** Save a backup file (plain); used by the reminder card and the Data section. */
export async function saveBackupFile(encrypted = false) {
  const text = await backupText(encrypted);
  await saveFile('reussite-backup-' + isoToday() + (encrypted ? '-encrypted' : '') + '.json', text);
  toast(t('backupSaved'));
}

export function SyncCards() {
  return (
    <>
      {syncOn.value && !keySaved.value && (
        <div class="banner warn" data-testid="key-card" role="status">
          <p><b>{t('syncKeyCardTitle')}.</b> {t('syncKeyCardBody')}</p>
          <div class="go">
            <button class="btn" type="button" onClick={openShowKey} data-testid="key-card-show">{t('syncShowKeyBtn')}</button>
            <button class="btn primary" type="button" onClick={() => void confirmKeySaved()} data-testid="key-card-saved">{t('syncKeySavedBtn')}</button>
          </div>
        </div>
      )}
      {!syncOn.value && backupDue.value && tasks.value.size > 0 && (
        <div class="banner" data-testid="backup-card" role="status">
          <p><b>{t('backupDueTitle')}.</b> {t('backupDueBody')}</p>
          <div class="go">
            <button class="btn primary" type="button" onClick={() => void saveBackupFile()} data-testid="backup-card-save">{t('backupDueSave')}</button>
            <button class="btn ghost" type="button" onClick={() => void snoozeBackupReminder()} data-testid="backup-card-snooze">{t('backupDueNotNow')}</button>
          </div>
        </div>
      )}
    </>
  );
}
