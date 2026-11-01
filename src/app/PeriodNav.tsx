// One ‹ label › navigator for a period (Today's day, the Calendar's day, three days, week or month), one compact row. The arrows sit in fixed columns at the
// two ends and never move whatever the label says; the label is centred between them (and cut with an ellipsis when it is long). Away from today a small
// "Today" chip joins the label on the same row (an icon alone on a very narrow screen), so nothing is reserved and nothing shifts. Tapping › or ‹ again and
// again in the same spot keeps stepping.
// With `pick`, the label is also a native date input (Today); otherwise it is plain text (the Calendar).
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';

export interface PeriodNavProps {
  label: ComponentChildren;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  /** The aria-label of the whole navigator. */
  name: string;
  /** Away from today: shows the return-to-today chip beside the label. */
  away: boolean;
  onToday: () => void;
  /** The label also opens the native date picker. */
  pick?: { value: string; label: string; onPick: (day: string) => void };
  testids: { prev: string; next: string; label?: string };
  class?: string;
}

export function PeriodNav(p: PeriodNavProps) {
  return (
    <nav class={'pnav' + (p.class ? ' ' + p.class : '')} aria-label={p.name}>
      <button class="icon-btn pnav-arrow pnav-prev" type="button" onClick={p.onPrev} aria-label={p.prevLabel} data-testid={p.testids.prev}>‹</button>
      <div class="pnav-mid">
        {p.pick ? (
          <label class="pnav-label pickable" data-testid={p.testids.label}>
            <span>{p.label}</span>
            <input type="date" value={p.pick.value} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) p.pick!.onPick(v); }} aria-label={p.pick.label} />
          </label>
        ) : <b class="pnav-label" data-testid={p.testids.label}>{p.label}</b>}
        {p.away && <button class="pnav-today" type="button" onClick={p.onToday} aria-label={t('backToToday')} title={t('backToToday')} data-testid="back-today"><span aria-hidden="true">↩<b>{t('pickToday')}</b></span></button>}
      </div>
      <button class="icon-btn pnav-arrow pnav-next" type="button" onClick={p.onNext} aria-label={p.nextLabel} data-testid={p.testids.next}>›</button>
    </nav>
  );
}
