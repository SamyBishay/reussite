// The place switcher (brief §5): look at another place's page without moving there, or say you're there.
import { settings, saveSettings, here, pagePlace, viewPlace, places } from './store';
import { AreaEditor } from './AreaUi';
import { areasOnPage, placeRows } from '../domain/areas';
import { openSheet, closeSheet } from './ui';
import { placeName } from './sheets';
import { addPlace } from './actions';
import { t } from '../i18n';

export function openPlaces() {
  openSheet(<PlacesSheet key={'places' + Date.now()} />);
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
      <p class="hint">{t('placesSheetHint', { place: placeName(here.value) })}</p>
      <ul class="picklist">{[...placeRows(places.value).filter(r => !r.area).map(r => r.id), 'any'].map(id => (
        <li><div><p>{placeName(id)}{id === here.value && <> <span class="tag today">{t('youAreHere')}</span></>}{id === pagePlace.value && id !== here.value && <> <span class="tag">{t('viewing')}</span></>}</p>
          {id !== 'any' && <details class="more"><summary>{t('areasOf', { place: placeName(id) })} · {areasOnPage(places.value, id).length}</summary><AreaEditor placeId={id} /></details>}</div>
          <div class="go">
            <button class="btn small" type="button" disabled={pagePlace.value === id} onClick={() => { viewPlace(id); closeSheet(); }}>{t('viewPage')}</button>
            <button class="btn small" type="button" disabled={settings.value.here === id && here.value === id} onClick={() => { void saveSettings({ here: id }); viewPlace(null); closeSheet(); }}>{t('imHere')}</button>
          </div></li>
      ))}</ul>
      <form class="addplace" onSubmit={add}>
        <input type="text" name="name" placeholder={t('newPlaceName')} aria-label={t('newPlaceName')} autocomplete="off" required />
        <button class="btn" type="submit" data-testid="add-place">{t('addPlaceBtn')}</button>
      </form>
      <p class="hint" style="margin-top:10px">{t('staysInSettings')}</p>
    </div>
  );
}
