// The place menu (brief §5), opened by the pill at the top right: each place with its areas under it and two ticks per row,
// "I'm here" (where the person is, which the planner and reminders follow) and "View" (what Today, the Matrix, Projects and
// the Calendar show, kept on the device); then Everywhere, which only views. "Places and areas…" opens the management sheet.
import { saveSettings, here, pageView, setView, currentStay, places } from './store';
import { AreaEditor } from './AreaUi';
import { areasOnPage, placeRows } from '../domain/areas';
import { ALL_VIEW } from '../domain/view';
import { openSheet, closeSheet } from './ui';
import { placeName, areaName } from './sheets';
import { addPlace } from './actions';
import { t, fmtDate } from '../i18n';

/** The pill's menu. */
export function openPlaceMenu() {
  openSheet(<PlaceMenu key={'placemenu' + Date.now()} />);
}
/** Add a place, and the areas inside each place (Home's menu → Places, and the menu's last row). */
export function openPlaces() {
  openSheet(<PlacesSheet key={'places' + Date.now()} />);
}

/** One box that is ticked or not, of a single choice: ticking another moves it, and the one that is ticked cannot be unticked. */
function Tick({ on, label, testid, disabled, onTick }: { on: boolean; label: string; testid: string; disabled?: boolean; onTick: () => void }) {
  return (
    <label class="pm-tick">
      <input type="checkbox" checked={on} disabled={disabled} aria-label={label} data-testid={testid}
        onChange={e => { const el = e.currentTarget as HTMLInputElement; if (!el.checked) { el.checked = true; return; } onTick(); }} />
    </label>
  );
}

function PlaceMenu() {
  const view = pageView.value, stay = currentStay.value;
  const rows: { id: string; area: boolean }[] = placeRows(places.value);
  return (
    <div class="placemenu" data-testid="place-menu">
      <h3>{t('where')}</h3>
      <p class="hint">{t('placeMenuHint')}</p>
      {stay && <p class="hint" data-testid="pm-stay">{t('placeMenuStay', { place: placeName(stay.placeId), date: fmtDate(stay.to) })}</p>}
      <div class="pm-row pm-head" aria-hidden="true"><span /><span>{t('imHere')}</span><span>{t('placeMenuView')}</span></div>
      <ul class="pm-list">
        {rows.map(r => (
          <li class={'pm-row' + (r.area ? ' pm-area' : '')} data-place={r.id}>
            <span class="pm-name">{areaName(r.id)}</span>
            <Tick on={here.value === r.id} disabled={!!stay} label={t('placeMenuHereAria', { place: placeName(r.id) })} testid={'pm-here-' + r.id} onTick={() => void saveSettings({ here: r.id })} />
            <Tick on={view.id === r.id} label={t('placeMenuViewAria', { place: placeName(r.id) })} testid={'pm-view-' + r.id} onTick={() => setView(r.id)} />
          </li>
        ))}
        <li class="pm-row pm-all" data-place={ALL_VIEW}>
          <span class="pm-name">{t('viewEverywhere')}</span>
          <span />
          <Tick on={view.all} label={t('placeMenuViewAria', { place: t('viewEverywhere') })} testid="pm-view-all" onTick={() => setView(ALL_VIEW)} />
        </li>
      </ul>
      <div class="actions"><button class="btn ghost" type="button" data-testid="pm-manage" onClick={() => { closeSheet(); openPlaces(); }}>{t('placeMenuManage')}</button></div>
    </div>
  );
}

function PlacesSheet() {
  const add = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
    if (!name) return;
    f.reset();
    await addPlace(name);
  };
  return (
    <div data-testid="places-sheet">
      <h3>{t('placesTitle')}</h3>
      <p class="hint">{t('placesManageHint')}</p>
      <ul class="picklist">{placeRows(places.value).filter(r => !r.area).map(r => r.id).map(id => (
        <li><div><p>{placeName(id)}</p>
          <details class="more"><summary>{t('areasOf', { place: placeName(id) })} · {areasOnPage(places.value, id).length}</summary><AreaEditor placeId={id} /></details></div></li>
      ))}</ul>
      <form class="addplace" onSubmit={add}>
        <input type="text" name="name" placeholder={t('newPlaceName')} aria-label={t('newPlaceName')} autocomplete="off" required />
        <button class="btn" type="submit" data-testid="add-place">{t('addPlaceBtn')}</button>
      </form>
      <p class="hint" style="margin-top:var(--s3)">{t('staysInSettings')}</p>
    </div>
  );
}
