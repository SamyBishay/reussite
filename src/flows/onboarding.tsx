// First-run onboarding (brief §12), one question per screen: language, places, suits, theme, Addresses &
// people, AI, the AI's preferences, sync, notifications, the recovery key; it ends on an offer to plan the
// first day. Every answer waits in a draft and is written, as ordinary settings and places, only when the
// person finishes: a device that pairs with an existing space must not push defaults that would win over
// the settings already there, and nothing is written for a screen they never touched.
import { useEffect, useState } from 'preact/hooks';
import { settings, saveSettings, createDoc, places } from '../app/store';
import { applyTheme, PRESETS } from '../app/theme';
import { go } from '../app/nav';
import { Mark } from '../app/Mark';
import { finishedOnboarding } from '../app/onboarding';
import { JoinPanel, KeyView } from '../app/SyncSettings';
import { NotifySwitch } from '../app/NotifySettings';
import { confirmKeySaved, keySaved, recoveryKeyText, relayBase, setupSync } from '../app/sync';
import { refreshPushState } from '../app/push';
import { KeyField, PreferencesEditor } from '../ai/AiSettings';
import { openCheckin } from './checkin';
import { lang, t, type Key } from '../i18n';
import { SUIT_ORDER, type AiProvider, type Settings, type ThemeMode } from '../data/settings';
import type { Place, SuitId } from '../data/schema';
import { DEFAULT_FORM, DETAILS, buildPreferences, type PreferenceForm } from '../domain/preferences';
import { ZONES, deviceZone } from '../domain/zones';
import type { ComponentChildren } from 'preact';

type Id = 'language' | 'places' | 'suits' | 'theme' | 'addresses' | 'ai' | 'prefs' | 'sync' | 'setup' | 'pair' | 'notify' | 'key' | 'done';
interface PlaceRow { name: string; timeZone: string }
interface Draft { s: Partial<Settings>; places: PlaceRow[] }
interface AiChoice { want: boolean; provider: Exclude<AiProvider, 'none'>; has: boolean }

/** The questions in order; a screen the device cannot use is left out (no relay: no sync; no push: no notifications). */
const SEQ: Id[] = ['language', 'places', 'suits', 'theme', 'addresses', 'ai', 'prefs', 'sync', 'notify', 'key', 'done'];
const usable = (id: Id): boolean =>
  id === 'sync' ? !!relayBase() : id === 'notify' ? refreshPushState() !== 'hidden' : id === 'key' ? !!recoveryKeyText() && !keySaved.value : true;
const after = (id: Id): Id => SEQ.slice(SEQ.indexOf(id) + 1).find(usable) ?? 'done';

/** What the draft turns into: places first (so the first can be where the person is), then one settings write. */
export async function applyDraft(d: Draft, l: Settings['language'], ai: AiChoice): Promise<void> {
  const made: string[] = [];
  const taken = new Set([...places.value.values()].map(p => p.name.toLowerCase()));
  for (const r of d.places) {
    const name = r.name.trim();
    if (!name || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    made.push(await createDoc<Place>('places', { name, timeZone: r.timeZone || deviceZone(), order: places.value.size + made.length }));
  }
  const patch: Partial<Settings> = { ...d.s, language: l };
  if (ai.want && ai.has) patch.aiProvider = ai.provider;
  if (made[0]) patch.here = made[0];
  await saveSettings(patch);
}

function Frame({ id, n, of, title, hint, children, back, next, nextLabel = 'next_', nextDisabled, skip, extra, mark }: {
  id: Id; n: number; of: number; title: string; hint?: string; children?: ComponentChildren; back?: () => void; next?: () => void;
  nextLabel?: Key; nextDisabled?: boolean; skip?: () => void; extra?: ComponentChildren; mark?: boolean;
}) {
  return (
    <div class="flow ob" data-testid={'ob-' + id}>
      {mark && <Mark size={72} class="ob-mark" />}
      <p class="eyebrow">{t('obStep', { n, of })}</p>
      <h3>{title}</h3>
      {hint && <p class="hint">{hint}</p>}
      {children}
      <div class="actions ob-actions">
        {back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}
        {next && <button class="btn primary" type="button" onClick={next} disabled={nextDisabled} data-testid="ob-next">{t(nextLabel)}</button>}
      </div>
      {extra}
      {skip && <button class="linklike ob-skip" type="button" onClick={skip} data-testid="ob-skip">{t('obSkip')}</button>}
    </div>
  );
}

const Choice = ({ on, onClick, title, hint, testid }: { on?: boolean; onClick: () => void; title: string; hint?: string; testid: string }) => (
  <button type="button" class="btn" aria-pressed={on} onClick={onClick} data-testid={testid}><b>{title}</b>{hint && <small>{hint}</small>}</button>
);

export function Onboarding() {
  const [id, setId] = useState<Id>('language');
  const [trail, setTrail] = useState<Id[]>([]);
  const [draft, setDraft] = useState<Draft>({ s: {}, places: [{ name: '', timeZone: deviceZone() }] });
  const [skipped, setSkipped] = useState(false);
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<AiChoice>({ want: false, provider: 'openai', has: false });
  const [form, setForm] = useState<PreferenceForm>(DEFAULT_FORM);
  const s = settings.value;
  const merged: Settings = { ...s, ...draft.s, language: lang.value };

  // A French phone starts in French (the person can switch on the first screen).
  useEffect(() => {
    if (/^fr\b/i.test(navigator.language ?? '') && lang.value !== 'fr') { lang.value = 'fr'; set({ language: 'fr' }); }
  }, []);
  // The look shows as it is chosen; nothing is saved until the end.
  useEffect(() => { applyTheme(merged); });

  const set = (p: Partial<Settings>) => setDraft(d => ({ ...d, s: { ...d.s, ...p } }));
  const goTo = (to: Id) => { setTrail([...trail, id]); setId(to); window.scrollTo({ top: 0 }); };
  const back = trail.length ? () => { setId(trail[trail.length - 1]!); setTrail(trail.slice(0, -1)); } : undefined;
  const next = () => goTo(after(id));
  const skip = () => { setSkipped(true); goTo('done'); };

  const nominal: Id[] = SEQ.filter(usable).filter(x => x !== 'done');
  const pos = { n: Math.max(1, nominal.indexOf(id) + 1), of: nominal.length };
  const frame = { id, ...pos, back };

  /** Write the draft (unless the space on another device is the source of truth), then leave. */
  const finish = async (then: 'home' | 'checkin') => {
    setBusy(true);
    if (!paired) await applyDraft(draft, lang.value, ai);
    await finishedOnboarding(skipped ? 'skipped' : 'done');
    go('home');
    if (then === 'checkin') openCheckin();
  };

  const pairedNow = () => {
    // The space has the settings and places; what was drafted here is dropped and the look goes back to what was there.
    setPaired(true);
    setDraft({ s: {}, places: [] });
    setTrail([]);
    setId(usable('notify') ? 'notify' : 'done');
  };

  const notTherapy = <p class="hint ob-notherapy" data-testid="ob-not-therapy">{t('notTherapy')}</p>;

  if (id === 'language') return (
    <Frame {...frame} mark title={t('obWelcome')} hint={t('obLanguageHint')} next={next} skip={skip}
      extra={<>
        <button class="btn wide ob-pair-link" type="button" onClick={() => goTo('pair')} data-testid="ob-pair-link">{t('obHaveDevice')}</button>
        {notTherapy}
      </>}>
      <div class="bigchoices" role="group" aria-label={t('language')}>
        {([['en', 'English'], ['fr', 'Français']] as const).map(([l, name]) => (
          <button type="button" class="btn" lang={l} aria-pressed={lang.value === l} data-testid={'ob-lang-' + l} onClick={() => { lang.value = l; set({ language: l }); }}><b>{name}</b></button>
        ))}
      </div>
    </Frame>
  );

  if (id === 'places') {
    const rows = draft.places;
    const setRows = (r: PlaceRow[]) => setDraft(d => ({ ...d, places: r }));
    const edit = (i: number, p: Partial<PlaceRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
    const zones = (z: string) => (ZONES.includes(z) ? ZONES : [z, ...ZONES]);
    return (
      <Frame {...frame} title={t('obPlacesQ')} hint={t('obPlacesHint')} next={next} nextDisabled={!rows.some(r => r.name.trim())} skip={skip}>
        {rows.map((r, i) => (
          <div class="obplace" data-testid="ob-place">
            <input type="text" value={r.name} placeholder={t('obPlacePh')} aria-label={t('placeName')} autocomplete="off" data-testid="ob-place-name" onInput={e => edit(i, { name: (e.target as HTMLInputElement).value })} />
            {rows.length > 1 && <button class="btn ghost" type="button" aria-label={t('remove', { what: r.name.trim() || t('placeName') })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>}
            <select aria-label={t('timeZone')} value={r.timeZone} onChange={e => edit(i, { timeZone: (e.target as HTMLSelectElement).value })}>
              {zones(r.timeZone).map(z => <option value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        ))}
        <div class="actions"><button class="btn" type="button" onClick={() => setRows([...rows, { name: '', timeZone: rows[rows.length - 1]?.timeZone ?? deviceZone() }])} data-testid="ob-place-add">{t('addPlaceBtn')}</button></div>
        <p class="hint">{t('obPlacesAnywhere')}</p>
      </Frame>
    );
  }

  if (id === 'suits') {
    const suits = merged.suits;
    const save = (k: SuitId, field: 'name' | 'glyph', v: string) => {
      const cur = suits[k];
      const next = field === 'glyph' ? { ...cur, glyph: v.trim() || cur.glyph } : { ...cur, name: { ...cur.name, [lang.value]: v.trim() || cur.name[lang.value] } };
      set({ suits: { ...suits, [k]: next } });
    };
    return (
      <Frame {...frame} title={t('obSuitsQ')} hint={t('obSuitsHint')} next={next} nextLabel="obKeepThese" skip={skip}>
        {SUIT_ORDER.map(k => (
          <div class="obsuit" key={k + lang.value}>
            <input type="text" defaultValue={suits[k].glyph} maxLength={2} aria-label={t('obSuitGlyph', { suit: suits[k].name[lang.value] })} data-testid={'ob-glyph-' + k} onChange={e => save(k, 'glyph', (e.target as HTMLInputElement).value)} />
            <input type="text" defaultValue={suits[k].name[lang.value]} aria-label={t('obSuitName')} data-testid={'ob-suit-' + k} autocomplete="off" onChange={e => save(k, 'name', (e.target as HTMLInputElement).value)} />
          </div>
        ))}
      </Frame>
    );
  }

  if (id === 'theme') return (
    <Frame {...frame} title={t('obThemeQ')} next={next} skip={skip}>
      <div class="field"><span>{t('theme')}</span>
        <div class="seg" role="group" aria-label={t('theme')}>
          {([['system', 'themeSystem'], ['light', 'themeLight'], ['dark', 'themeDark'], ['time', 'themeTime']] as [ThemeMode, Key][]).map(([v, k]) =>
            <button type="button" style="min-height:44px" aria-pressed={merged.theme === v} data-testid={'ob-theme-' + v} onClick={() => set({ theme: v })}>{t(k)}</button>)}
        </div>
      </div>
      <div class="field"><span>{t('palette')}</span>
        <div class="presets" role="group" aria-label={t('palette')}>
          {Object.entries(PRESETS).map(([pid, p]) => (
            <button type="button" class="btn preset" aria-pressed={merged.preset === pid} data-testid={'ob-preset-' + pid} onClick={() => set({ preset: pid, accent: p.accent, suitColors: { ...p.suitColors } })}>
              <span class="dots" aria-hidden="true"><i style={{ background: p.accent }} />{SUIT_ORDER.map(k => <i style={{ background: p.suitColors[k] }} />)}</span>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <label class="field"><span>{t('accent')}</span>
        <input type="color" value={merged.accent} style="min-height:44px;width:72px;padding:2px" data-testid="ob-accent" onChange={e => set({ accent: (e.target as HTMLInputElement).value.toUpperCase(), preset: 'custom' })} />
      </label>
    </Frame>
  );

  if (id === 'addresses') return (
    <Frame {...frame} title={t('obAddressesQ')} hint={t('obAddressesHint')} next={next} skip={skip}>
      <div class="bigchoices" role="group" aria-label={t('addrSwitch')}>
        <Choice on={merged.addressesPeople} onClick={() => set({ addressesPeople: true })} title={t('obYes')} hint={t('obAddressesYes')} testid="ob-addresses-yes" />
        <Choice on={!merged.addressesPeople} onClick={() => set({ addressesPeople: false })} title={t('obNotNow')} hint={t('obAddressesNo')} testid="ob-addresses-no" />
      </div>
    </Frame>
  );

  if (id === 'ai') return (
    <Frame {...frame} title={t('obAiQ')} hint={t('obAiHint')} next={next} skip={skip}>
      <div class="bigchoices" role="group" aria-label={t('aiSection')}>
        <Choice on={!ai.want} onClick={() => setAi({ ...ai, want: false })} title={t('obAiNo')} hint={t('obAiNoHint')} testid="ob-ai-no" />
        <Choice on={ai.want} onClick={() => setAi({ ...ai, want: true })} title={t('obAiYes')} hint={t('obAiYesHint')} testid="ob-ai-yes" />
      </div>
      {ai.want && (
        <>
          <div class="field"><span>{t('aiProvider')}</span>
            <div class="seg" role="group" aria-label={t('aiProvider')}>
              {([['openai', 'aiOpenAI'], ['anthropic', 'aiAnthropic']] as const).map(([v, k]) =>
                <button type="button" style="min-height:44px" aria-pressed={ai.provider === v} data-testid={'ob-ai-' + v} onClick={() => setAi({ ...ai, provider: v })}>{t(k)}</button>)}
            </div>
          </div>
          <KeyField p={ai.provider} onHas={has => setAi(a => (a.has === has ? a : { ...a, has }))} />
          {!ai.has && <p class="hint">{t('obAiNeedsKey')}</p>}
        </>
      )}
    </Frame>
  );

  if (id === 'prefs') {
    const change = (f: PreferenceForm) => { setForm(f); set({ aiPreferences: buildPreferences(f) }); };
    const text = merged.aiPreferences;
    return (
      <Frame {...frame} title={t('obPrefsQ')} hint={t('obPrefsHint')} next={next} skip={skip}>
        <div class="field"><span>{t('obPrefsDetail')}</span>
          <div class="seg" role="group" aria-label={t('obPrefsDetail')}>
            {DETAILS.map(v => <button type="button" style="min-height:44px" aria-pressed={form.detail === v} data-testid={'ob-detail-' + v.replace(' ', '-')} onClick={() => change({ ...form, detail: v })}>{t(v === 'very short' ? 'obDetailVeryShort' : v === 'short' ? 'obDetailShort' : 'obDetailFull')}</button>)}
          </div>
        </div>
        <label class="field"><span>{t('obPrefsKnow')}</span>
          <input type="text" value={form.know} placeholder={t('obPrefsKnowPh')} autocomplete="off" data-testid="ob-prefs-know" onInput={e => change({ ...form, know: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field"><span>{t('obPrefsNever')}</span>
          <input type="text" value={form.never} placeholder={t('obPrefsNeverPh')} autocomplete="off" data-testid="ob-prefs-never" onInput={e => change({ ...form, never: (e.target as HTMLInputElement).value })} />
        </label>
        <details class="more"><summary>{t('obPrefsText')}</summary>
          <PreferencesEditor value={text} onSave={v => set({ aiPreferences: v })} testid="ob-prefs-text" />
        </details>
      </Frame>
    );
  }

  if (id === 'sync') return (
    <Frame {...frame} title={t('obSyncQ')} hint={t('syncIntro')} next={next} nextLabel="obNotNow" skip={skip}>
      <div class="bigchoices">
        <Choice onClick={() => goTo('setup')} title={t('obSyncSetUp')} hint={t('obSyncSetUpHint')} testid="ob-sync-setup" />
        <Choice onClick={() => goTo('pair')} title={t('obHaveDevice')} hint={t('obSyncPairHint')} testid="ob-sync-pair" />
      </div>
    </Frame>
  );

  if (id === 'setup') return (
    <div class="flow ob" data-testid="ob-setup">
      <h3>{t('syncSetUpTitle')}</h3>
      <p>{t('syncSetUpBody')}</p>
      <p class="warnline">{t('syncWarning')}</p>
      <div class="actions ob-actions">
        {back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}
        <button class="btn primary" type="button" disabled={busy} data-testid="ob-make-key" onClick={async () => { setBusy(true); await setupSync(); setBusy(false); setTrail([...trail, 'sync']); setId(after('sync')); }}>{t('syncMakeKey')}</button>
      </div>
    </div>
  );

  if (id === 'pair') return (
    <div class="flow ob" data-testid="ob-pair">
      <JoinPanel onJoined={pairedNow} />
      <div class="actions ob-actions">{back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}</div>
      <p class="hint">{t('obPairSkips')}</p>
    </div>
  );

  if (id === 'notify') return (
    <Frame {...frame} title={t('obNotifyQ')} hint={t('notifyIntro')} next={next} nextLabel="obNotNow" skip={paired ? undefined : skip}>
      <NotifySwitch />
    </Frame>
  );

  if (id === 'key') return (
    <Frame {...frame} title={t('syncYourKey')} next={next} nextLabel="syncKeyLater" skip={skip}
      extra={<div class="actions"><button class="btn primary" type="button" data-testid="ob-key-saved" onClick={async () => { await confirmKeySaved(); next(); }}>{t('syncKeySavedBtn')}</button></div>}>
      <p>{t('obKeyHint')}</p>
      <KeyView text={recoveryKeyText()} />
    </Frame>
  );

  return (
    <div class="flow ob" data-testid="ob-done">
      <h3>{skipped ? t('obDoneSkipped') : t('obDone')}</h3>
      <p>{paired ? t('obDonePaired') : t('obDoneHint')}</p>
      <div class="bigchoices">
        <button type="button" class="btn primary" disabled={busy} onClick={() => void finish('checkin')} data-testid="ob-plan"><b>{t('obPlanFirst')}</b><small>{t('obPlanFirstHint')}</small></button>
        <button type="button" class="btn" disabled={busy} onClick={() => void finish('home')} data-testid="ob-home"><b>{t('obGoHome')}</b></button>
      </div>
      <div class="actions ob-actions">{back && <button class="btn ghost" type="button" onClick={back} disabled={busy} data-testid="ob-back">{t('back')}</button>}</div>
      {notTherapy}
    </div>
  );
}
