// One ‹ label › navigator for a period (Today's day, the Calendar's day, three days, week or month). The arrows sit in fixed columns at the two ends and
// never move whatever the label says; the label is centred between them (and cut with an ellipsis when it is long); under the label is a line that is
// always reserved, so "Back to today" appears in it without shifting anything. Tapping › or ‹ again and again in the same spot keeps stepping.
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
  /** Away from today: shows the return-to-today chip in the reserved line. */
  away: boolean;
  onToday: () => void;
  /** A quiet line in the reserved slot while at today (Today says the date); the return chip takes its place when away. */
  sub?: ComponentChildren;
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
        <div class="pnav-slot">{p.away ? <button class="pnav-today" type="button" onClick={p.onToday} data-testid="back-today">{t('backToToday')}</button> : p.sub ? <span class="pnav-sub">{p.sub}</span> : null}</div>
      </div>
      <button class="icon-btn pnav-arrow pnav-next" type="button" onClick={p.onNext} aria-label={p.nextLabel} data-testid={p.testids.next}>›</button>
    </nav>
  );
}
