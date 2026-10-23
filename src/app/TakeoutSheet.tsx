// Import once from a Google Maps list exported with Google Takeout (brief §5, Addresses). Pick the file and the
// place, read the summary, then write. Importing only adds: a row already on the list may fill its empty note,
// link or street and never replaces one (invariant 1), so a second import adds nothing.
import { useState } from 'preact/hooks';
import { addresses, here, readOnly, toast } from './store';
import { createAddress, editAddress } from './actions';
import { closeSheet, openSheet } from './ui';
import { PlaceSelect } from './sheets';
import { t } from '../i18n';
import { parseTakeout, type TakeoutResult } from '../domain/takeout';

export function openTakeout(place: string = here.value) {
  openSheet(<TakeoutSheet key={'takeout' + Date.now()} place={place} />, true);
}

function TakeoutSheet({ place }: { place: string }) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [where, setWhere] = useState(place);
  const [names, setNames] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Read against what is on the list now, so the summary is what Add will write.
  let r: TakeoutResult | null = null;
  if (text != null) {
    try { r = parseTakeout(text, { placeId: where, existing: addresses.value.values() }); } catch { r = null; }
  }
  const choose = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    setErr(''); setNames({});
    try { setText(await f.text()); setFileName(f.name); } catch { setText(null); setErr(t('takeoutUnreadable')); }
  };
  const named = r ? r.drafts.map((d, i) => ({ d, name: (d.name || names[i] || '').trim() })) : [];
  const ready = named.filter(x => x.name);
  const nothing = !!r && !ready.length && !r.fills.length;
  const go = async () => {
    if (!r || busy) return;
    setBusy(true);
    for (const x of ready) await createAddress({ name: x.name, placeId: where, note: x.d.note, mapsUrl: x.d.mapsUrl, street: x.d.street, state: 'want' });
    for (const f of r.fills) await editAddress(f.id, f.fields);
    closeSheet();
    toast(t('takeoutDone', { n: ready.length, m: r.fills.length }));
  };
  return (
    <div data-testid="takeout-sheet">
      <h3>{t('takeoutTitle')}</h3>
      <p class="hint">{t('takeoutHint')}</p>
      <div class="actions"><label class="btn">{t('chooseFile')}<input type="file" accept=".csv,.json,.geojson,text/csv,application/json,application/geo+json" hidden onChange={choose} data-testid="takeout-file" /></label></div>
      {fileName && <p class="hint" style="margin-top:var(--s2)">{fileName}</p>}
      <label class="field"><span>{t('takeoutWhere')}</span><PlaceSelect value={where} onChange={setWhere} /></label>
      {err && <p class="err">{err}</p>}
      {text != null && !r && <p class="err" data-testid="takeout-bad">{t('takeoutUnreadable')}</p>}
      {r && (
        <div data-testid="takeout-summary" style="margin-top:var(--s4)">
          <div class="counts">
            <span>{t('takeoutRows')}</span><span class="n" data-testid="takeout-rows">{r.counts.rows}</span><span />
            <span>{t('takeoutAdded')}</span><span class="n" data-testid="takeout-added">{ready.length}</span><span />
            <span>{t('takeoutDuplicates')}</span><span class="n" data-testid="takeout-dups">{r.counts.duplicates}</span><span />
            <span>{t('takeoutFilled')}</span><span class="n" data-testid="takeout-filled">{r.counts.filled}</span><span />
            <span>{t('takeoutSkipped')}</span><span class="n" data-testid="takeout-skipped">{r.counts.skipped + (r.drafts.length - ready.length)}</span><span />
          </div>
          {r.drafts.some(d => d.needsName) && (
            <div class="field"><span>{t('takeoutNeedName', { n: r.drafts.filter((d, i) => d.needsName && !names[i]?.trim()).length })}</span>
              <ul class="mini">{r.drafts.map((d, i) => d.needsName && (
                <li><input type="text" value={names[i] ?? ''} placeholder={t('addrName')} aria-label={t('addrName')} autocomplete="off" onInput={e => setNames({ ...names, [i]: (e.target as HTMLInputElement).value })} data-testid="takeout-name" /></li>
              ))}</ul>
            </div>
          )}
          {nothing && <p class="hint" data-testid="takeout-nothing">{t('takeoutNothing')}</p>}
        </div>
      )}
      <div class="actions">
        <button class="btn primary" type="button" disabled={readOnly.value || busy || !r || nothing} onClick={() => void go()} data-testid="takeout-go">{t('takeoutGo')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
}
