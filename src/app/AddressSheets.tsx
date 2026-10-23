// The sheets of Addresses and people (brief §5, phase 4): a new address from a pasted Maps link, an address's
// page with its visits, the one-screen after-visit note, a person. Reads the signals live; writes through
// actions.ts. Nothing here is sent anywhere.
import { More, countSet } from './More';
import { useRef, useState } from 'preact/hooks';
import { here, readOnly, toast, today, tasks } from './store';
import { addressById, categories, categoryName, personById, type A } from './model';
import { createAddress, editAddress, removeAddress, recordVisit, editVisit, createPerson, editPerson, removePerson } from './actions';
import { openSheet, closeSheet, ExtLink, Title } from './ui';
import { PlaceSelect, openTask, placeName } from './sheets';
import { stepsOfPerson } from '../domain/people';
import { t, fmtDate, type Key } from '../i18n';
import { isAllowedLink } from '../domain/links';
import { readShared, urlIn } from '../domain/mapsLink';
import { reachKind, reachLink, reachOptions } from '../domain/reach';
import { VERDICTS, type Address, type Verdict, type Visit } from '../data/schema';

const val = (e: Event) => (e.target as HTMLInputElement).value;
export const VERDICT_KEY: Record<Verdict, Key> = { again: 'verdictAgain', maybe: 'verdictMaybe', 'not-again': 'verdictNotAgain' };
const REACH_KEY: Record<string, Key> = { whatsapp: 'reachWhatsapp', sms: 'reachMessages', tel: 'reachPhone', mail: 'reachMail', other: 'reachOther' };
export const reachLabel = (link: string) => t(REACH_KEY[reachKind(link)]!);

/** A category's label on an address: its name, or "Uncategorised" when the list no longer has it (its addresses stay). */
export const categoryLabel = (id: string) => (categories().some(c => c.id === id) ? categoryName(id) : t('addrUncategorised'));

// What was picked last is the next default: a run of cafés is one tap each.
const CAT_KEY = 'reussite.addrCat';
const lastCategory = (): string => {
  const list = categories();
  let c = '';
  try { c = localStorage.getItem(CAT_KEY) ?? ''; } catch { /* fine */ }
  return list.some(x => x.id === c) ? c : list.some(x => x.id === 'other') ? 'other' : list[0]?.id ?? 'other';
};
const rememberCategory = (c: string) => { try { localStorage.setItem(CAT_KEY, c); } catch { /* fine */ } };

// ---------- an address ----------
/** A new address; the place defaults to the one `place` names, else where the person is now. */
export function openNewAddress(place: string = here.value) {
  openSheet(<AddressSheet key={'na' + Date.now()} id={null} place={place} />);
}
export function openAddress(id: string) {
  openSheet(<AddressSheet key={id + Date.now()} id={id} place={here.value} />);
}

function AddressSheet({ id, place }: { id: string | null; place: string }) {
  const cur = addressById(id);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(cur?.name ?? '');
  const [cat, setCat] = useState(cur?.category ?? lastCategory());
  const [where, setWhere] = useState(cur?.placeId ?? place);
  const [url, setUrl] = useState(cur?.mapsUrl ?? '');
  const [street, setStreet] = useState(cur?.street ?? '');
  const [state, setState] = useState<Address['state']>(cur?.state ?? 'want');
  const [note, setNote] = useState(cur?.note ?? '');
  const [msg, setMsg] = useState<Key | null>(null);
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState(false);
  // Without a clipboard to read (Firefox) or after a refusal, a plain field to paste into.
  const [manual, setManual] = useState(typeof navigator === 'undefined' || !navigator.clipboard?.readText);
  const [pasted, setPasted] = useState('');
  if (id && !cur) return <p class="hint">{t('addrGone')}</p>;

  /** Take a Maps link (or the text around one): name and link where the link says them, else ask for the name. */
  const take = (text: string) => {
    setErr('');
    const shared = readShared(text);
    if (shared) {
      setUrl(shared.url);
      setName(shared.place.name);
      if (shared.place.street) setStreet(shared.place.street);
      setMsg('addrPasteRead');
      return;
    }
    const u = urlIn(text);
    if (u && isAllowedLink(u)) {
      setUrl(u);
      setMsg('addrPasteNoName');
      nameRef.current?.focus();
    } else setMsg('addrPasteNoLink');
  };
  const paste = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { setManual(true); setMsg('addrPasteBlocked'); return; }
    if (!text.trim()) { setManual(true); setMsg('addrPasteEmpty'); return; }
    take(text);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const n = name.trim(), link = url.trim();
    if (!n) { setErr(t('addrNameNeeded')); nameRef.current?.focus(); return; }
    if (link && !isAllowedLink(link)) { setErr(t('linkRefused')); return; }
    const fields = { name: n, category: cat, placeId: where, mapsUrl: link || null, street: street.trim() || null, state, note };
    if (cur) {
      const p: Partial<Address> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) if ((fields[k] ?? null) !== ((cur[k] as unknown) ?? null)) (p as Record<string, unknown>)[k] = fields[k];
      // Saving an address an AI suggested confirms it: from then on it is the person's own.
      if (cur.by === 'ai') p.by = 'me';
      if (Object.keys(p).length) await editAddress(cur.id, p);
    } else await createAddress(fields);
    rememberCategory(cat);
    closeSheet();
    toast(t('saved'));
  };
  const remove = async () => {
    if (!cur) return;
    if (!armed) return setArmed(true);
    await removeAddress(cur.id);
    closeSheet();
    toast(t('addrRemoved'));
  };

  const off = readOnly.value;
  // A category the list no longer has stays selectable, so the address keeps it.
  const known = categories();
  return (
    <form onSubmit={submit} data-testid="address-sheet">
      <h3>{cur ? cur.name : t('addrNew')}</h3>
      {!cur && (
        <div data-testid="addr-paste-box">
          <p class="hint">{t('addrPasteHint')}</p>
          <div class="actions" style="margin-top:var(--s3)"><button class="btn primary" type="button" onClick={() => void paste()} data-testid="addr-paste">{t('addrPaste')}</button></div>
          {manual && (
            <label class="field"><span>{t('addrPasteField')}</span>
              <textarea rows={2} value={pasted} placeholder="https://maps.app.goo.gl/…" autocomplete="off" onInput={e => { setPasted(val(e)); if (val(e).trim()) take(val(e)); }} data-testid="addr-paste-field" />
            </label>
          )}
          {msg && <p class={'hint' + (msg === 'addrPasteNoName' ? ' ask' : '')} role="status" data-testid="addr-paste-msg">{t(msg)}</p>}
        </div>
      )}
      <label class="field"><span>{t('addrName')}</span>
        <input type="text" ref={nameRef} value={name} autocomplete="off" onInput={e => setName(val(e))} data-testid="addr-name" />
      </label>
      <div class="row2">
        <label class="field"><span>{t('addrCategory')}</span>
          <select value={cat} onChange={e => setCat(val(e))} data-testid="addr-category">
            {known.map(c => <option value={c.id}>{c.name}</option>)}
            {!known.some(c => c.id === cat) && <option value={cat}>{t('addrUncategorised')}</option>}
          </select>
        </label>
        <label class="field"><span>{t('where')}</span><PlaceSelect value={where} onChange={setWhere} /></label>
      </div>
      <div class="field"><span>{t('addrState')}</span>
        <div class="seg" role="group" aria-label={t('addrState')}>
          <button type="button" aria-pressed={state === 'want'} onClick={() => setState('want')} data-testid="addr-want">{t('addrWant')}</button>
          <button type="button" aria-pressed={state === 'been'} onClick={() => setState('been')} data-testid="addr-been">{t('addrBeen')}</button>
        </div>
      </div>
      {err && <p class="err">{err}</p>}
      <More n={countSet(url, street, note)} testid="addr-more">
      <label class="field"><span>{t('addrLink')}</span>
        <input type="text" inputMode="url" value={url} placeholder="https://…" autocomplete="off" onInput={e => setUrl(val(e))} data-testid="addr-link" />
      </label>
      <label class="field"><span>{t('addrStreet')}</span>
        <input type="text" value={street} autocomplete="off" onInput={e => setStreet(val(e))} data-testid="addr-street" />
      </label>
      <label class="field"><span>{t('note')}</span><textarea value={note} onInput={e => setNote(val(e))} data-testid="addr-note" /></label>
      </More>
      {cur?.mapsUrl && isAllowedLink(cur.mapsUrl) && <div class="actions" style="margin-top:var(--s3)"><ExtLink href={cur.mapsUrl} class="btn" testid="addr-open-maps">{t('addrOpenMaps')}</ExtLink></div>}
      <div class="actions">
        <button class="btn primary" type="submit" disabled={off} data-testid="addr-save">{t('save')}</button>
        {cur && <button class="btn" type="button" disabled={off} onClick={() => openVisit(cur.id, {})} data-testid="addr-visit">{t('addrRecordVisit')}</button>}
      </div>
      {cur && <Visits a={cur} />}
      {cur && (
        <div class="actions" style="margin-top:var(--s2)">
          <button class="btn ghost small" type="button" disabled={off} onClick={() => void remove()} data-testid="addr-remove">{armed ? t('deleteAgain') : t('addrRemove')}</button>
        </div>
      )}
    </form>
  );
}

function Visits({ a }: { a: A }) {
  const list = [...a.visits].sort((x, y) => y.day.localeCompare(x.day));
  return (
    <div class="field" data-testid="addr-visits"><span>{t('addrVisits')}</span>
      {list.length ? (
        <ul class="sesslist visitlist">{list.map(v => (
          <li>
            <span class="n">{fmtDate(v.day, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span class="why"><b>{t(VERDICT_KEY[v.verdict])}</b>{v.note && ' · ' + v.note}</span>
            <button class="btn small ghost" type="button" onClick={() => openVisit(a.id, { visit: v })} data-testid="visit-edit">{t('edit')}</button>
          </li>
        ))}</ul>
      ) : <p class="hint">{t('addrNoVisits')}</p>}
    </div>
  );
}

// ---------- after a visit ----------
/**
 * The after-visit screen: a short note on how it was, and again / maybe / not again. Opened when a step that
 * feeds the address is done (`stepId`, `day` is the day it was done) and by hand from the address; with `visit`
 * it edits one already written. Skipping writes nothing.
 */
export function openVisit(addressId: string, o: { stepId?: string | null; day?: string; visit?: Visit }) {
  openSheet(<VisitSheet key={'visit' + addressId + (o.visit?.id ?? Date.now())} addressId={addressId} stepId={o.stepId ?? null} day={o.day ?? today.value} visit={o.visit} />);
}

function VisitSheet({ addressId, stepId, day, visit }: { addressId: string; stepId: string | null; day: string; visit?: Visit }) {
  const a = addressById(addressId);
  const [note, setNote] = useState(visit?.note ?? '');
  const [d, setD] = useState(visit?.day ?? day);
  const [verdict, setVerdict] = useState<Verdict | null>(visit?.verdict ?? null);
  const [armed, setArmed] = useState(false);
  if (!a) return <p class="hint">{t('addrGone')}</p>;
  const off = readOnly.value;
  // After a step, the day is the step's; by hand and when editing it can be changed.
  const dated = !stepId;
  const back = () => openAddress(addressId);
  const save = async (v: Verdict) => {
    if (visit) await editVisit(addressId, visit.id, { day: d || visit.day, note: note.trim(), verdict: v });
    else await recordVisit(addressId, { note, verdict: v, day: d || day, stepId });
    if (visit) back(); else { closeSheet(); toast(t('visitSaved')); }
  };
  const del = async () => {
    if (!visit) return;
    if (!armed) return setArmed(true);
    await editVisit(addressId, visit.id, null);
    back();
  };
  return (
    <div data-testid="visit-sheet">
      <h3>{visit ? t('visitEditTitle', { name: a.name }) : t('visitTitle', { name: a.name })}</h3>
      <p class="hint">{visit ? t('visitEditHint') : t('visitHint')}</p>
      <label class="field"><span>{t('visitNote')}</span>
        <textarea value={note} placeholder={t('visitNotePh')} onInput={e => setNote(val(e))} data-testid="visit-note" />
      </label>
      {(dated || visit) && <label class="field"><span>{t('day')}</span><input type="date" value={d} max={today.value} onInput={e => setD(val(e) || day)} data-testid="visit-day" /></label>}
      <p class="field-label">{t('visitAgainQ')}</p>
      <div class="chips-pick verdicts" role="group" aria-label={t('visitAgainQ')}>
        {VERDICTS.map(v => (
          <button type="button" aria-pressed={verdict === v} disabled={off} onClick={() => (visit ? setVerdict(v) : void save(v))} data-testid={'verdict-' + v}>{t(VERDICT_KEY[v])}</button>
        ))}
      </div>
      <div class="actions">
        {visit ? (
          <>
            <button class="btn primary" type="button" disabled={off || !verdict} onClick={() => verdict && void save(verdict)} data-testid="visit-save">{t('save')}</button>
            <button class="btn" type="button" onClick={back}>{t('back')}</button>
            <button class="btn ghost" type="button" disabled={off} onClick={() => void del()} data-testid="visit-delete">{armed ? t('deleteAgain') : t('visitDelete')}</button>
          </>
        ) : <button class="btn ghost" type="button" onClick={closeSheet} data-testid="visit-skip">{t('skip')}</button>}
      </div>
    </div>
  );
}

// ---------- a person ----------
export function openNewPerson(place: string = here.value) {
  openSheet(<PersonSheet key={'np' + Date.now()} id={null} place={place} />);
}
export function openPerson(id: string) {
  openSheet(<PersonSheet key={id + Date.now()} id={id} place={here.value} />);
}

/** A person's page: what is open with them (steps that go to them or name them) and where they are. */
export function openPersonPage(id: string) {
  openSheet(<PersonPage key={'pp' + id + Date.now()} id={id} />);
}

function PersonPage({ id }: { id: string }) {
  const p = personById(id);
  if (!p) return null;
  const steps = stepsOfPerson({ id, name: p.name }, tasks.value.values());
  return (
    <div data-testid="person-page" class="personpage">
      <h3>{t('personPageTitle', { name: p.name })}</h3>
      <p class="hint">{t('personArea', { place: placeName(p.placeId) })} · {p.lastSeen ? t('personSeenOn', { date: fmtDate(p.lastSeen, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('personNotSeen')}</p>
      <p class="hint">{t('personPageHint')}</p>
      {!steps.length && <p class="hint" data-testid="person-page-empty">{t('personPageEmpty', { name: p.name })}</p>}
      <ul class="picklist">{steps.map(({ step, via }) => (
        <li data-testid="person-page-step"><div>
          <button type="button" class="linklike" onClick={() => openTask(step.id)}><b><Title s={step.title} /></b></button>
          <p class="meta">{[step.due ? fmtDate(step.due, { weekday: 'short', day: 'numeric', month: 'short' }) + (step.at ? ' ' + step.at : '') : '', t(via === 'linked' ? 'personLinked' : 'personNamed')].filter(Boolean).join(' · ')}</p>
        </div></li>
      ))}</ul>
      <div class="actions"><button class="btn" type="button" onClick={() => openPerson(id)}>{t('edit')}</button></div>
    </div>
  );
}

function PersonSheet({ id, place }: { id: string | null; place: string }) {
  const cur = personById(id);
  const [name, setName] = useState(cur?.name ?? '');
  const [where, setWhere] = useState(cur?.placeId ?? place);
  const [reach, setReach] = useState(cur?.reach ?? '');
  const [note, setNote] = useState(cur?.note ?? '');
  const [seen, setSeen] = useState(cur?.lastSeen ?? '');
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState(false);
  if (id && !cur) return <p class="hint">{t('personGone')}</p>;
  const off = readOnly.value;
  const options = reachOptions(reach);
  const submit = async (e: Event) => {
    e.preventDefault();
    const n = name.trim(), r = reach.trim();
    if (!n) { setErr(t('personNameNeeded')); return; }
    const link = r ? reachLink(r) : null;
    if (r && !link) { setErr(options.length ? t('reachChoose') : t('linkRefused')); return; }
    const fields = { name: n, placeId: where, reach: link, note, lastSeen: seen || null };
    if (cur) {
      const p: Record<string, unknown> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) if ((fields[k] ?? null) !== (cur[k] ?? null)) p[k] = fields[k];
      if (Object.keys(p).length) await editPerson(cur.id, p);
    } else await createPerson(fields);
    closeSheet();
    toast(t('saved'));
  };
  const remove = async () => {
    if (!cur) return;
    if (!armed) return setArmed(true);
    await removePerson(cur.id);
    closeSheet();
    toast(t('personRemoved'));
  };
  return (
    <form onSubmit={submit} data-testid="person-sheet">
      <h3>{cur ? cur.name : t('personNew')}</h3>
      <p class="hint">{t('personHint')}</p>
      <label class="field"><span>{t('addrName')}</span>
        <input type="text" value={name} autocomplete="off" onInput={e => setName(val(e))} data-testid="person-name" />
      </label>
      <label class="field"><span>{t('where')}</span><PlaceSelect value={where} onChange={setWhere} /></label>
      <label class="field"><span>{t('personReach')}</span>
        <input type="text" inputMode="url" value={reach} placeholder={t('personReachPh')} autocomplete="off" onInput={e => setReach(val(e))} data-testid="person-reach" />
      </label>
      {options.length > 0 && reachLink(reach) == null && (
        <div class="chips-pick small" data-testid="person-reach-options" role="group" aria-label={t('reachUseAs')}>
          {options.map(o => <button type="button" onClick={() => setReach(o.link)} data-testid={'reach-' + o.kind}>{t(REACH_KEY[o.kind]!)}</button>)}
        </div>
      )}
      <p class="hint">{t('personReachHint')}</p>
      {err && <p class="err">{err}</p>}
      <More n={countSet(note, seen)} testid="person-more">
      <label class="field"><span>{t('note')}</span><textarea value={note} onInput={e => setNote(val(e))} data-testid="person-note" /></label>
      <div class="field"><span>{t('personLastSeen')}</span>
        <div class="row-inline">
          <input type="date" value={seen} max={today.value} aria-label={t('personLastSeen')} onInput={e => setSeen(val(e))} data-testid="person-seen" />
          <button class="btn small" type="button" onClick={() => setSeen(today.value)}>{t('personSeenToday')}</button>
          {seen && <button class="btn small ghost" type="button" onClick={() => setSeen('')}>{t('clearIt')}</button>}
        </div>
        <p class="hint">{seen ? t('personSeenOn', { date: fmtDate(seen, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }) : t('personNotSeen')}</p>
      </div>
      </More>
      <div class="actions">
        <button class="btn primary" type="submit" disabled={off} data-testid="person-save">{t('save')}</button>
        {cur?.reach && isAllowedLink(cur.reach) && <ExtLink href={cur.reach} class="btn" testid="person-open">{t('personOpen', { app: reachLabel(cur.reach) })}</ExtLink>}
      </div>
      {cur && <div class="actions" style="margin-top:var(--s2)"><button class="btn ghost small" type="button" disabled={off} onClick={() => void remove()} data-testid="person-remove">{armed ? t('deleteAgain') : t('personRemove')}</button></div>}
    </form>
  );
}
