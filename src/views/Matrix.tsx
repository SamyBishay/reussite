// The Eisenhower matrix, ported from v1. Moves between quadrants arrive in phase 1.
import { useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { tasks, today, settings } from '../app/store';
import { isOpen, inPlace, quad, byPriority, rawPlan, blocked, type T } from '../app/model';
import { openTask, placeName } from '../app/sheets';
import { Title, Suit, quadName } from '../app/ui';
import { t, fmtDate, type Key } from '../i18n';
import { daysBetween } from '../domain/dates';

/** "In <place>" or "Everything", shared by Matrix and Projects; remembered per device. */
const initialScope = (() => { try { return localStorage.getItem('reussite.scope') === 'all' ? 'all' : 'here'; } catch { return 'here'; } })();
export const scope = signal<'here' | 'all'>(initialScope);
const setScope = (v: 'here' | 'all') => { scope.value = v; try { localStorage.setItem('reussite.scope', v); } catch { /* fine */ } };

export function Scope({ hidden }: { hidden: number }) {
  return (
    <div class="scope">
      <div class="seg" role="group" aria-label={t('show')}>
        <button type="button" aria-pressed={scope.value !== 'all'} onClick={() => setScope('here')}>{t('inPlace', { place: placeName(settings.value.here) })}</button>
        <button type="button" aria-pressed={scope.value === 'all'} onClick={() => setScope('all')}>{t('everything')}</button>
      </div>
      {scope.value !== 'all' && hidden > 0 && <span>{t('hiddenElsewhere', { n: hidden })}</span>}
    </div>
  );
}

const META: Record<number, [Key, Key]> = { 1: ['qNowSub', 'qNowHint'], 2: ['qProtectSub', 'qProtectHint'], 3: ['qQuickSub', 'qQuickHint'], 4: ['qLaterSub', 'qLaterHint'] };

function Item({ tk, planned }: { tk: T; planned: boolean }) {
  return (
    <button class="item" type="button" onClick={() => openTask(tk.id)}>
      <Suit s={tk.suit} />
      <span class="t"><Title s={tk.title} />
        {tk.kind === 'decision' && <> <span class="tag">{t('decisionTag')}</span></>}
        {planned && <> <span class="tag today">{t('today')}</span></>}
        {blocked(tk) && <> <span class="tag">{t('waits')}</span></>}
      </span>
      {tk.due ? <span class={'due' + (daysBetween(today.value, tk.due) <= settings.value.urgencyDays ? ' soon' : '')}>{fmtDate(tk.due)}</span> : <span />}
    </button>
  );
}

export function Matrix() {
  const [expand, setExpand] = useState<Record<number, boolean>>({});
  const all = [...tasks.value.values()].filter(isOpen);
  const vis = all.filter(x => scope.value === 'all' || inPlace(x));
  const q: Record<number, T[]> = { 1: [], 2: [], 3: [], 4: [] };
  vis.forEach(x => q[quad(x)]!.push(x));
  Object.values(q).forEach(a => a.sort(byPriority));
  const planSet = new Set(rawPlan(today.value));
  return (
    <div>
      <Scope hidden={all.length - vis.length} />
      <div class="matrix">
        {[1, 2, 3, 4].map(k => {
          const items = q[k]!, shown = expand[k] ? items : items.slice(0, 8);
          return (
            <section class="quad" data-testid={'quad' + k}>
              <h3>{quadName(k)} <small>{t(META[k]![0])}</small><span class="count">{items.length}</span></h3>
              <p class="hint">{t(META[k]![1])}</p>
              <ul class="items">{shown.map(x => <li key={x.id}><Item tk={x} planned={planSet.has(x.id)} /></li>)}</ul>
              {items.length > 8 && !expand[k] && <button class="btn ghost small" type="button" onClick={() => setExpand({ ...expand, [k]: true })}>{t('showAll', { n: items.length })}</button>}
            </section>
          );
        })}
      </div>
      <p class="hint axis-note">{t('axisNote')}</p>
    </div>
  );
}
