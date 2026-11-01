// What the areas look like in the views (phase 4b): a small tag, and the editor for the areas of a place (Settings → Method
// and the Places sheet). Narrowing a page to one area is the place menu's View (src/app/PlacesSheet.tsx).
import { useState } from 'preact/hooks';
import { places, toast, update } from './store';
import { addArea, removeArea } from './actions';
import { areaName, placeName } from './sheets';
import { areasOnPage } from '../domain/areas';
import { t } from '../i18n';
import type { Place } from '../data/schema';

/** A small tag with an area's name, for a step in a list. */
export const AreaTag = ({ id }: { id: string }) => <span class="tag area" title={t('areaTag', { area: areaName(id) })}>{areaName(id)}</span>;

/** The areas of one place: rename, remove (what was set to one goes back to the place) and add. */
export function AreaEditor({ placeId }: { placeId: string }) {
  const [txt, setTxt] = useState('');
  const areas = areasOnPage(places.value, placeId).filter(id => id !== placeId);
  const add = async (e: Event) => {
    e.preventDefault();
    const name = txt.trim();
    if (!name) return;
    setTxt('');
    if (await addArea(placeId, name)) toast(t('areaAdded', { name }));
  };
  const remove = async (id: string) => {
    const name = areaName(id), place = placeName(placeId);
    await removeArea(id);
    toast(t('areaRemoved', { name, place }));
  };
  return (
    <div class="areaeditor" data-testid="area-editor" data-place={placeId}>
      {areas.length > 0 && <p class="hint areahint">{t('areasOf', { place: placeName(placeId) })}</p>}
      {areas.map(id => (
        <div class="arearow" data-testid="area-row">
          <input type="text" aria-label={t('areaName')} defaultValue={areaName(id)} onChange={e => update<Place>('places', id, { name: (e.target as HTMLInputElement).value.trim() || areaName(id) })} />
          <button class="btn small ghost" type="button" onClick={() => void remove(id)} aria-label={t('removeAreaBtn', { name: areaName(id) })}>×</button>
        </div>
      ))}
      <form class="arearow" onSubmit={add}>
        <input type="text" value={txt} onInput={e => setTxt((e.target as HTMLInputElement).value)} placeholder={t('newAreaName', { place: placeName(placeId) })} aria-label={t('newAreaName', { place: placeName(placeId) })} autocomplete="off" />
        <button class="btn small" type="submit" data-testid="add-area">{t('addAreaBtn')}</button>
      </form>
    </div>
  );
}
