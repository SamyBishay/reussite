// The footer: the version, the credit and the not-therapy line. Under every tab's content but Home's and the Calendar's grid (the Calendar shows it at the end of the Log).
import { settings } from './store';
import { t, lang, frTypo } from '../i18n';

export function Footer() {
  const credit = settings.value.credit?.[lang.value];
  return (
    <footer class="foot">
      <span>{t('version', { v: __APP_VERSION__ })}</span>
      {credit && <span>{lang.value === 'fr' ? frTypo(credit) : credit}</span>}
      <span>{t('notTherapy')}</span>
    </footer>
  );
}
