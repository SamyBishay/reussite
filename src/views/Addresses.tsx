// Addresses and people (brief §5, phase 4): the good addresses and the people of a place, lists made in
// advance so that "go out" becomes "Open the front door, then the bakery on the corner". They feed the plan;
// they are not a travel journal or a maps app. The screen follows the page being viewed and can show everything.
import { useState } from 'preact/hooks';
import { pagePlace, people, addresses, readOnly } from '../app/store';
import { addressesIn, peopleIn, addressesOn, lastVisitOf, type A, type P } from '../app/model';
import { ExtLink } from '../app/ui';
import { placeIds, placeName } from '../app/sheets';
import { openNewAddress, openAddress, openNewPerson, openPerson, categoryLabel, reachLabel, VERDICT_KEY } from '../app/AddressSheets';
import { openTakeout } from '../app/TakeoutSheet';
import { go } from '../app/nav';
import { isAllowedLink } from '../domain/links';
import { t, fmtDate } from '../i18n';

const ALL = '*';
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function AddressRow({ a, showPlace }: { a: A; showPlace: boolean }) {
  const v = lastVisitOf(a);
  const parts = [categoryLabel(a.category), showPlace && placeName(a.placeId)].filter(Boolean) as string[];
  return (
    <li data-testid="address-row">
      <div>
        <button type="button" class="linklike" onClick={() => openAddress(a.id)} data-testid="address-open"><b>{a.name}</b></button>
        <p class="meta">
          {parts.join(' · ')}{parts.length > 0 && ' · '}
          <span class="tag" data-state={a.state}>{a.state === 'been' ? t('addrBeen') : t('addrWant')}</span>
          {a.by === 'ai' && <> <span class="proposed" title={t('addrProposedHint')} data-testid="address-ai">{t('proposed')}</span></>}
          {v && <span> · {fmtDate(v.day)} · {t(VERDICT_KEY[v.verdict])}</span>}
        </p>
      </div>
      <div class="go">
        {a.mapsUrl && isAllowedLink(a.mapsUrl) && <ExtLink href={a.mapsUrl} class="btn small" testid="address-maps">{t('addrMaps')}</ExtLink>}
      </div>
    </li>
  );
}

function PersonRow({ p, showPlace }: { p: P; showPlace: boolean }) {
  return (
    <li data-testid="person-row">
      <div>
        <button type="button" class="linklike" onClick={() => openPerson(p.id)} data-testid="person-open-sheet"><b>{p.name}</b></button>
        <p class="meta">
          {showPlace && <span>{placeName(p.placeId)} · </span>}
          {p.lastSeen ? t('personSeenOn', { date: fmtDate(p.lastSeen, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('personNotSeen')}
        </p>
      </div>
      <div class="go">
        {p.reach && isAllowedLink(p.reach) && <ExtLink href={p.reach} class="btn small" testid="person-reach-open">{reachLabel(p.reach)}</ExtLink>}
      </div>
    </li>
  );
}

export function Addresses() {
  const [scope, setScope] = useState<string>(pagePlace.value);
  if (!addressesOn()) {
    return (
      <div data-testid="addresses-off">
        <h2 class="sec" style="margin-top:0">{t('addrTitle')}</h2>
        <p class="hint">{t('addrOff')}</p>
        <div class="actions"><button class="btn" type="button" onClick={() => go('settings')}>{t('tabSettings')}</button></div>
      </div>
    );
  }
  const all = scope === ALL;
  const list = (all ? [...addresses.value.values()].sort(byName) : addressesIn(scope));
  const folks = (all ? [...people.value.values()].sort(byName) : peopleIn(scope));
  const place = all ? pagePlace.value : scope;
  const off = readOnly.value;
  return (
    <div data-testid="addresses">
      <h2 class="sec" style="margin-top:0">{t('addrTitle')}</h2>
      <p class="hint">{t('addrIntro')}</p>
      <div class="actions">
        <button class="btn primary" type="button" disabled={off} onClick={() => openNewAddress(place)} data-testid="addr-new">{t('addrNewBtn')}</button>
        <button class="btn" type="button" disabled={off} onClick={() => openNewPerson(place)} data-testid="person-new">{t('personNewBtn')}</button>
        <button class="btn ghost" type="button" disabled={off} onClick={() => openTakeout(place)} data-testid="addr-import">{t('takeoutBtn')}</button>
      </div>
      <label class="field"><span>{t('addrShowing')}</span>
        <select value={scope} onChange={e => setScope((e.target as HTMLSelectElement).value)} data-testid="addr-scope">
          {[...placeIds(), 'any'].map(id => <option value={id}>{placeName(id)}</option>)}
          <option value={ALL}>{t('addrEverywhere')}</option>
        </select>
      </label>

      <h3 class="sec">{t('addrSection')}</h3>
      {!list.length && <p class="hint" data-testid="addr-empty">{t('addrEmpty')}</p>}
      <ul class="picklist addrlist">{list.map(a => <AddressRow key={a.id} a={a} showPlace={all} />)}</ul>

      <h3 class="sec">{t('peopleSection')}</h3>
      {!folks.length && <p class="hint" data-testid="people-empty">{t('peopleEmpty')}</p>}
      <ul class="picklist addrlist">{folks.map(p => <PersonRow key={p.id} p={p} showPlace={all} />)}</ul>
    </div>
  );
}
