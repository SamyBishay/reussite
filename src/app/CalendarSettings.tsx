// Settings → Calendar (brief §8): what Add to calendar does; the subscribable feed (step 5) goes below.
import { t } from '../i18n';

export function CalendarSettings() {
  return (
    <section class="set" data-testid="calendar-settings">
      <h2>{t('calendarSection')}</h2>
      <p class="hint">{t('calendarExportHint')}</p>
      <div data-testid="calendar-feed">{/* The feed block goes here. */}</div>
    </section>
  );
}
