// Home (brief §5): a greeting, one card and the input. The menu icon at the top holds what has no tab:
// Settings, Places, Memory and History. The greeting, card and input are built in the next step.
import { today } from '../app/store';
import { dayDoc } from '../app/model';
import { openSheet, closeSheet } from '../app/ui';
import { openPlaces } from '../app/PlacesSheet';
import { go, type View } from '../app/nav';
import { t, fmtDate } from '../i18n';

function HomeMenu() {
  const to = (v: View) => { closeSheet(); go(v); };
  return (
    <div data-testid="home-menu-sheet">
      <h3>{t('menu')}</h3>
      <ul class="picklist menu">
        <li><button type="button" class="linklike" onClick={() => to('settings')} data-testid="menu-settings"><b>{t('tabSettings')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => { closeSheet(); openPlaces(); }} data-testid="menu-places"><b>{t('placesTitle')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => to('memory')} data-testid="menu-memory"><b>{t('memoryTitle')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => to('history')} data-testid="menu-history"><b>{t('historyTitle')}</b></button></li>
      </ul>
    </div>
  );
}

export function Home() {
  const d = dayDoc(today.value);
  return (
    <div class="home" data-testid="home">
      <header class="homebar">
        <div data-testid="greeting">
          <p class="dateline">{fmtDate(today.value, { weekday: 'long', day: 'numeric', month: 'long' })}{d?.closed ? ' · ' + t('dayClosed') : ''}</p>
        </div>
        <button type="button" class="icon-btn" onClick={() => openSheet(<HomeMenu />)} aria-label={t('menu')} data-testid="home-menu">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>
    </div>
  );
}
