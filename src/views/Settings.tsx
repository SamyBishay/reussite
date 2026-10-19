// Settings (brief §7), phase 0: Appearance, Method, Language, Data, About.
import { useEffect, useState } from 'preact/hooks';
import { settings, saveSettings, places, stays, db, toast, update, readOnly, today } from '../app/store';
import { openSheet, closeSheet, suitName } from '../app/ui';
import { placeIds, placeName } from '../app/sheets';
import { addPlace, saveStay, removeStay } from '../app/actions';
import changelog from '../../CHANGELOG.md?raw';
import { t, lang, type Key } from '../i18n';
import { PRESETS, contrast, AA } from '../app/theme';
import { SUIT_ORDER, type Settings as S, type ThemeMode, type Celebrations, type TextSize } from '../data/settings';
import { makeBackup, parseBackup, restoreBackup, saveFile } from '../data/backup';
import { importV1, writeImport, type ImportSummary, type V2Data } from '../data/import-v1';
import type { Place, Stay, SuitId } from '../data/schema';
import { addDays } from '../domain/dates';
import { DiagnosticsButton } from '../app/Diagnostics';
import { AiSettings } from '../ai/AiSettings';

const set = (p: Partial<S>) => void saveSettings(p);
const CARD_LIGHT = '#FFFFFF';
const isoToday = () => new Date().toISOString().slice(0, 10);

function Seg<V extends string>({ value, options, onChange, label }: { value: V; options: [V, Key][]; onChange: (v: V) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label} style="flex-wrap:wrap">
      {options.map(([v, k]) => <button type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t(k)}</button>)}
    </div>
  );
}

function Contrast({ color }: { color: string }) {
  const r = contrast(color, CARD_LIGHT);
  const txt = r.toFixed(1).replace('.', lang.value === 'fr' ? ',' : '.');
  return r < AA ? <p class="err" style="font-size:13px">{t('contrastWarn', { r: txt })}</p> : <p class="hint" style="font-size:12.5px">{t('contrastOk', { r: txt })}</p>;
}

/** A colour input that saves when the picker closes, not on every drag. */
function ColorField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label>{label}
      <input type="color" value={v} onInput={e => setV((e.target as HTMLInputElement).value.toUpperCase())} onChange={e => onSave((e.target as HTMLInputElement).value.toUpperCase())} />
      <Contrast color={v} />
    </label>
  );
}

function Appearance() {
  const s = settings.value;
  const importTheme = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.format !== 'reussite-theme' || typeof j.accent !== 'string' || typeof j.suitColors !== 'object') throw new Error();
      set({ accent: j.accent, suitColors: { ...s.suitColors, ...j.suitColors }, preset: 'custom' });
      toast(t('themeImported'));
    } catch { toast(t('themeInvalid')); }
    (e.target as HTMLInputElement).value = '';
  };
  return (
    <section class="set" data-testid="appearance">
      <h2>{t('appearance')}</h2>
      <div class="field"><span>{t('theme')}</span>
        <Seg<ThemeMode> label={t('theme')} value={s.theme} onChange={v => set({ theme: v })} options={[['system', 'themeSystem'], ['light', 'themeLight'], ['dark', 'themeDark'], ['time', 'themeTime']]} />
      </div>
      {s.theme === 'time' && (
        <div class="row2">
          <label class="field"><span>{t('lightFrom')}</span><input type="time" value={s.lightAt} onChange={e => set({ lightAt: (e.target as HTMLInputElement).value })} /></label>
          <label class="field"><span>{t('darkFrom')}</span><input type="time" value={s.darkAt} onChange={e => set({ darkAt: (e.target as HTMLInputElement).value })} /></label>
        </div>
      )}
      <label class="field"><span>{t('palette')}</span>
        <select value={s.preset} onChange={e => { const id = (e.target as HTMLSelectElement).value; const p = PRESETS[id]; if (p) set({ preset: id, accent: p.accent, suitColors: { ...p.suitColors } }); }}>
          {Object.entries(PRESETS).map(([id, p]) => <option value={id}>{p.name}</option>)}
          {s.preset === 'custom' && <option value="custom">—</option>}
        </select>
      </label>
      <div class="field"><span>{t('accent')} · {t('suitColours')}</span>
        <div class="colors">
          <ColorField label={t('accent')} value={s.accent} onSave={v => set({ accent: v, preset: 'custom' })} />
          {SUIT_ORDER.map(k => <ColorField label={s.suits[k].glyph + ' ' + suitName(k, true)} value={s.suitColors[k]} onSave={v => set({ suitColors: { ...s.suitColors, [k]: v }, preset: 'custom' })} />)}
        </div>
      </div>
      <div class="field"><span>{t('textSize')}</span>
        <Seg<TextSize> label={t('textSize')} value={s.textSize} onChange={v => set({ textSize: v })} options={[['S', 'sizeS'], ['M', 'sizeM'], ['L', 'sizeL']]} />
      </div>
      <div class="field"><span>{t('celebrations')}</span>
        <Seg<Celebrations> label={t('celebrations')} value={s.celebrations} onChange={v => set({ celebrations: v })} options={[['off', 'celOff'], ['calm', 'celCalm'], ['lively', 'celLively']]} />
      </div>
      <div class="toggles" style="margin-top:14px">
        <label class="tog"><input type="checkbox" checked={s.reduceMotion} onChange={e => set({ reduceMotion: (e.target as HTMLInputElement).checked })} /> {t('reduceMotion')}</label>
        <label class="tog"><input type="checkbox" checked={s.linksInApp} onChange={e => set({ linksInApp: (e.target as HTMLInputElement).checked })} /> {t('linksInApp')}</label>
        <label class="tog"><input type="checkbox" checked={s.sound} onChange={e => set({ sound: (e.target as HTMLInputElement).checked })} /> {t('soundLabel')}</label>
      </div>
      {s.sound && <label class="field"><span>{t('volume')}</span><input type="range" min="0" max="1" step="0.1" value={s.volume} onChange={e => set({ volume: Number((e.target as HTMLInputElement).value) })} /></label>}
      <div class="actions">
        <button class="btn small" type="button" onClick={() => saveFile('reussite-theme.json', JSON.stringify({ format: 'reussite-theme', accent: s.accent, suitColors: s.suitColors }, null, 1))}>{t('exportTheme')}</button>
        <label class="btn small">{t('importTheme')}<input type="file" accept="application/json,.json" hidden onChange={importTheme} /></label>
      </div>
    </section>
  );
}

function NumberField({ label, value, min, max, onSave }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void }) {
  return (
    <label class="field"><span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={value}
        onChange={e => { const n = Math.round(Number((e.target as HTMLInputElement).value)); if (n >= min && n <= max) onSave(n); }} />
    </label>
  );
}

const ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return []; } })();

function PlacesEditor() {
  const ps = placeIds().map(id => places.value.get(id)!);
  const add = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
    if (!name) return;
    f.reset();
    await addPlace(name);
    toast(t('placeAdded', { name }));
  };
  return (
    <div class="field" data-testid="places"><span>{t('places')}</span>
      <p class="hint">{t('placesHint')}</p>
      {ps.map(p => (
        <div class="placerow">
          <input type="text" aria-label={t('placeName')} defaultValue={p.name} onChange={e => update<Place>('places', p.id, { name: (e.target as HTMLInputElement).value.trim() || p.name })} />
          <select aria-label={t('timeZone')} value={p.timeZone} onChange={e => update<Place>('places', p.id, { timeZone: (e.target as HTMLSelectElement).value })}>
            {(ZONES.includes(p.timeZone) ? ZONES : [p.timeZone, ...ZONES]).map(z => <option value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      ))}
      <form class="addplace" onSubmit={add}>
        <input type="text" name="name" placeholder={t('newPlaceName')} aria-label={t('newPlaceName')} autocomplete="off" required />
        <button class="btn" type="submit" data-testid="add-place">{t('addPlaceBtn')}</button>
      </form>
      <label class="field"><span>{t('currentPlace')}</span>
        <select value={settings.value.here} onChange={e => set({ here: (e.target as HTMLSelectElement).value })}>
          {[...placeIds(), 'any'].map(id => <option value={id}>{placeName(id)}</option>)}
        </select>
      </label>
      <p class="hint">{t('currentPlaceHint')}</p>
    </div>
  );
}

/** Stays: a place with a first and last day. On the first day the current place switches by itself. */
export function StaysEditor() {
  const list = [...stays.value.values()].sort((a, b) => a.from.localeCompare(b.from)).filter(s => s.to >= addDays(today.value, -60));
  const ps = placeIds();
  const add = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
    if (!v('placeId') || !v('from') || !v('to')) return;
    const from = v('from'), to = v('to') < from ? from : v('to');
    await saveStay(null, { placeId: v('placeId'), from, to, note: v('note').trim() });
    f.reset();
    toast(t('stayAdded'));
  };
  return (
    <div class="field" data-testid="stays"><span>{t('stays')}</span>
      <p class="hint">{t('staysHint')}</p>
      {list.map(st => (
        <div class="stayrow">
          <select aria-label={t('placeName')} value={st.placeId} onChange={e => void saveStay(st.id, { ...st, placeId: (e.target as HTMLSelectElement).value })}>{ps.map(id => <option value={id}>{placeName(id)}</option>)}</select>
          <input type="date" aria-label={t('stayFrom')} value={st.from} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) void saveStay(st.id, { ...st, from: v }); }} />
          <input type="date" aria-label={t('stayTo')} value={st.to} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) void saveStay(st.id, { ...st, to: v }); }} />
          <button class="btn small ghost" type="button" onClick={() => void removeStay(st.id)} aria-label={t('remove', { what: placeName(st.placeId) })}>×</button>
        </div>
      ))}
      {ps.length ? (
        <form class="stayrow" onSubmit={add}>
          <select name="placeId" aria-label={t('placeName')}>{ps.map(id => <option value={id}>{placeName(id)}</option>)}</select>
          <input type="date" name="from" aria-label={t('stayFrom')} required />
          <input type="date" name="to" aria-label={t('stayTo')} required />
          <input type="hidden" name="note" value="" />
          <button class="btn small" type="submit">{t('add')}</button>
        </form>
      ) : <p class="hint">{t('addPlaceFirst')}</p>}
    </div>
  );
}

function Method() {
  const s = settings.value;
  const saveSuit = (k: SuitId, field: 'name' | 'short' | 'glyph', v: string) => {
    const cur = s.suits[k];
    const next = field === 'glyph' ? { ...cur, glyph: v || cur.glyph } : { ...cur, [field]: { ...cur[field], [lang.value]: v || cur[field][lang.value] } };
    set({ suits: { ...s.suits, [k]: next } });
  };
  return (
    <section class="set" data-testid="method">
      <h2>{t('method')}</h2>
      <div class="row2">
        <NumberField label={t('urgencyWindow')} value={s.urgencyDays} min={1} max={120} onSave={n => set({ urgencyDays: n })} />
        <label class="field"><span>{t('dayStartsAt')}</span><input type="time" value={s.dayStart} onChange={e => set({ dayStart: (e.target as HTMLInputElement).value || '05:00' })} /></label>
      </div>
      <div class="row2">
        <NumberField label={t('maxWorkSteps')} value={s.maxWorkSteps} min={1} max={10} onSave={n => set({ maxWorkSteps: n })} />
        <NumberField label={t('planningTime')} value={s.planningMin} min={0} max={120} onSave={n => set({ planningMin: n })} />
      </div>
      <div class="row2">
        <label class="field"><span>{t('defaultStart')}</span><input type="time" value={s.launchDefaults.start} onChange={e => set({ launchDefaults: { ...s.launchDefaults, start: (e.target as HTMLInputElement).value } })} /></label>
        <label class="field"><span>{t('defaultRestarts')}</span>
          <input type="text" defaultValue={s.launchDefaults.restarts.join(', ')} placeholder="14:00, 17:30" aria-describedby="restartsHint"
            onChange={e => set({ launchDefaults: { ...s.launchDefaults, restarts: (e.target as HTMLInputElement).value.split(/[,\s]+/).filter(x => /^\d{2}:\d{2}$/.test(x)) } })} />
        </label>
      </div>
      <p class="hint" id="restartsHint">{t('restartsHint')}</p>
      <div class="field"><span>{t('suits')}</span>
        {SUIT_ORDER.map(k => (
          <div class="suitrow" key={k + lang.value}>
            <label class="field" style="margin:0"><span>{t('suitGlyph')}</span><input type="text" maxLength={2} defaultValue={s.suits[k].glyph} onChange={e => saveSuit(k, 'glyph', (e.target as HTMLInputElement).value.trim())} /></label>
            <label class="field" style="margin:0"><span>{t('suitName')}</span><input type="text" defaultValue={s.suits[k].name[lang.value]} onChange={e => saveSuit(k, 'name', (e.target as HTMLInputElement).value.trim())} /></label>
            <label class="field" style="margin:0"><span>{t('suitShort')}</span><input type="text" defaultValue={s.suits[k].short[lang.value]} onChange={e => saveSuit(k, 'short', (e.target as HTMLInputElement).value.trim())} /></label>
          </div>
        ))}
      </div>
      <div class="row2">
        <label class="field"><span>{t('obligationAt')}</span><input type="time" value={s.obligationAt} onChange={e => set({ obligationAt: (e.target as HTMLInputElement).value || '18:00' })} /></label>
        <label class="field"><span>{t('reviewDay')}</span>
          <select value={String(s.reviewDay)} onChange={e => set({ reviewDay: Number((e.target as HTMLSelectElement).value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map(d => <option value={d}>{new Date(Date.UTC(2026, 9, 4 + d)).toLocaleDateString(lang.value === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', timeZone: 'UTC' })}</option>)}
          </select>
        </label>
      </div>
      <div class="row2">
        <label class="field"><span>{t('reviewTime')}</span><input type="time" value={s.reviewTime} onChange={e => set({ reviewTime: (e.target as HTMLInputElement).value || '18:00' })} /></label>
        <label class="field"><span>{t('morningAt')}</span><input type="time" value={s.morningAt} onChange={e => set({ morningAt: (e.target as HTMLInputElement).value || '08:30' })} /></label>
      </div>
      <div class="row2">
        <label class="field"><span>{t('eveningAt')}</span><input type="time" value={s.eveningAt} onChange={e => set({ eveningAt: (e.target as HTMLInputElement).value || '21:00' })} /></label>
      </div>
      <p class="hint">{t('remindersLater')}</p>
      <PlacesEditor />
      <StaysEditor />
    </section>
  );
}

// ---------- import from v1 ----------
const COLL_KEY: Record<string, Key> = { tasks: 'collTasks', sessions: 'collSessions', projects: 'collProjects', days: 'collDays', decisions: 'collDecisions', places: 'collPlaces', stays: 'collStays', meta: 'collMeta' };

function ImportSheet() {
  const [state, setState] = useState<{ data: V2Data; summary: ImportSummary } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const choose = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { setErr(''); setState(importV1(JSON.parse(await f.text()))); } catch (x) { setState(null); setErr(t('importError', { msg: (x as Error).message })); }
  };
  const go = async () => {
    if (!state) return;
    setBusy(true);
    await writeImport(db, state.data);
    void navigator.storage?.persist?.().catch(() => undefined);
    closeSheet();
    toast(t('importDone'));
  };
  const s = state?.summary;
  return (
    <div data-testid="import">
      <h3>{t('importTitle')}</h3>
      <p class="hint">{t('importHint')}</p>
      <div class="actions"><label class="btn">{t('chooseFile')}<input type="file" accept="application/json,.json" hidden onChange={choose} data-testid="import-file" /></label></div>
      {err && <><p class="err" style="margin-top:12px">{err}</p><div class="actions"><DiagnosticsButton /></div></>}
      {s && (
        <>
          <div class="counts" data-testid="import-summary">
            <b /> <b>{t('importFound')}</b><b>{t('importWillWrite')}</b>
            {Object.keys(s.produced).filter(c => s.produced[c] || s.found[c]).map(c => (
              <><span>{t(COLL_KEY[c] ?? 'collMeta')}</span><span class="n">{s.found[c] ?? '—'}</span><span class="n">{s.produced[c]}</span></>
            ))}
          </div>
          <p class="hint" style="margin-top:10px">{s.skipped.length ? t('importSkipped', { n: s.skipped.length }) + ': ' + s.skipped.map(x => x.collection + ' ' + x.id + ' (' + x.reason + ')').join('; ') : t('importNothingSkipped')}</p>
          <div class="actions"><button class="btn primary" type="button" disabled={busy || readOnly.value} onClick={go}>{t('importConfirm')}</button><button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button></div>
        </>
      )}
    </div>
  );
}

function Data() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null)); }, []);
  // Asked on a tap, never on load: Firefox shows a permission prompt for it.
  const keep = () => navigator.storage.persist().then(setPersisted, () => undefined);
  const exportBackup = async () => {
    const b = await makeBackup(db);
    await saveFile('reussite-backup-' + isoToday() + '.json', JSON.stringify(b));
    toast(t('backupSaved'));
  };
  const restore = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      const file = parseBackup(JSON.parse(await f.text()));
      if (!confirm(t('restoreConfirm'))) return;
      await restoreBackup(db, file);
      toast(t('restored'));
    } catch (x) { toast(t('importError', { msg: (x as Error).message })); }
  };
  return (
    <section class="set" data-testid="data">
      <h2>{t('data')}</h2>
      <div class="actions" style="margin-top:8px">
        <button class="btn" type="button" onClick={exportBackup}>{t('exportBackup')}</button>
        <label class="btn">{t('importBackup')}<input type="file" accept="application/json,.json" hidden onChange={restore} /></label>
        <button class="btn" type="button" onClick={() => openSheet(<ImportSheet key={'imp' + Date.now()} />)} data-testid="open-import">{t('importV1')}</button>
      </div>
      {persisted !== null && <p class="hint" style="margin-top:10px">{t('storage')}: {persisted ? t('storagePersisted') : t('storageNotPersisted')}</p>}
      {persisted === false && <div class="actions" style="margin-top:8px"><button class="btn small" type="button" onClick={keep}>{t('keepData')}</button></div>}
    </section>
  );
}

export function Settings() {
  return (
    <div>
      <section class="set">
        <h2>{t('language')}</h2>
        <div class="seg" role="group" aria-label={t('language')} style="margin-top:8px">
          <button type="button" aria-pressed={settings.value.language === 'en'} onClick={() => set({ language: 'en' })} lang="en">English</button>
          <button type="button" aria-pressed={settings.value.language === 'fr'} onClick={() => set({ language: 'fr' })} lang="fr">Français</button>
        </div>
      </section>
      <Appearance />
      <Method />
      <AiSettings />
      <Data />
      <section class="set" data-testid="about">
        <h2>{t('about')}</h2>
        <p class="hint">{t('version', { v: __APP_VERSION__ })}</p>
        <div class="actions"><DiagnosticsButton ghost={false} /></div>
        {settings.value.credit?.[lang.value] && <p>{settings.value.credit[lang.value]}</p>}
        <p class="hint">{t('notTherapy')}</p>
        <details class="more"><summary>{t('changelog')}</summary><pre class="changelog">{changelog}</pre></details>
      </section>
    </div>
  );
}
