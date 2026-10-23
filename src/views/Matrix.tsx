// The Eisenhower matrix (brief §5). Moves: drag on desktop and tablet; on phones, long-press
// or the "Move to…" menu. Filters by project, suit and place, and search.
import { useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { tasks, today, settings, projects, pagePlace } from '../app/store';
import { isOpen, isObligation, inPlace, quad, byPriority, rawPlan, blocked, type T } from '../app/model';
import { openTask, openMove, moveToQuadrant, placeName, placeIds } from '../app/sheets';
import { Title, Suit, quadName, DueChip, suitName } from '../app/ui';
import { t, type Key } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import type { Quadrant } from '../domain/tasks';
import { CommandBox } from '../ai/ui';
import { openDecision } from '../flows/decision';

/** "On this page" or "Everything", shared by Matrix and Projects; remembered per device. */
const initialScope = (() => { try { return localStorage.getItem('reussite.scope') === 'all' ? 'all' : 'here'; } catch { return 'here'; } })();
export const scope = signal<'here' | 'all'>(initialScope);
const setScope = (v: 'here' | 'all') => { scope.value = v; try { localStorage.setItem('reussite.scope', v); } catch { /* fine */ } };

export function Scope({ hidden }: { hidden: number }) {
  return (
    <div class="scope">
      <div class="seg" role="group" aria-label={t('show')}>
        <button type="button" aria-pressed={scope.value !== 'all'} onClick={() => setScope('here')}>{t('inPlace', { place: placeName(pagePlace.value) })}</button>
        <button type="button" aria-pressed={scope.value === 'all'} onClick={() => setScope('all')}>{t('everything')}</button>
      </div>
      {scope.value !== 'all' && hidden > 0 && <span>{t('hiddenElsewhere', { n: hidden })}</span>}
    </div>
  );
}

const META: Record<number, [Key, Key]> = { 1: ['qNowSub', 'qNowHint'], 2: ['qProtectSub', 'qProtectHint'], 3: ['qQuickSub', 'qQuickHint'], 4: ['qLaterSub', 'qLaterHint'] };
const filters = signal({ q: '', project: '', suit: '', place: '' });

/** Long-press opens the Move menu on touch screens. */
function useLongPress(onLong: () => void) {
  const timer = useRef(0);
  const fired = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: (e: PointerEvent) => { if (e.pointerType === 'mouse') return; fired.current = false; timer.current = window.setTimeout(() => { fired.current = true; onLong(); }, 500); },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel, onPointerMove: (e: PointerEvent) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancel(); },
    onContextMenu: (e: Event) => { if (fired.current) e.preventDefault(); },
    wasLong: () => { const f = fired.current; fired.current = false; return f; },
  };
}

function Item({ tk, planned }: { tk: T; planned: boolean }) {
  const lp = useLongPress(() => openMove(tk.id));
  const { wasLong, ...handlers } = lp;
  return (
    <div class="item" draggable data-task={tk.id} onDragStart={e => { e.dataTransfer?.setData('text/plain', tk.id); (e.currentTarget as HTMLElement).classList.add('dragging'); }}
      onDragEnd={e => (e.currentTarget as HTMLElement).classList.remove('dragging')}>
      <Suit s={tk.suit} />
      <button type="button" class="linklike t" {...handlers} onClick={() => { if (!wasLong()) openTask(tk.id); }}>
        <Title s={tk.title} />
        {tk.kind === 'decision' && <> <span class="tag">{t('decisionTag')}</span></>}
        {planned && <> <span class="tag today">{t('today')}</span></>}
        {blocked(tk) && <> <span class="tag">{t('waits')}</span></>}
      </button>
      <span class="ictrls">
        <DueChip tk={tk} />
        {tk.kind === 'decision' && <button type="button" class="icon-btn sm" onClick={() => void openDecision(null, { taskId: tk.id })} aria-label={t('openDecision')} data-testid="matrix-decision">⚖</button>}
        <button type="button" class="icon-btn sm" onClick={() => openMove(tk.id)} aria-label={t('moveTo')} data-testid="move-btn">⇄</button>
      </span>
    </div>
  );
}

export function Matrix() {
  const [expand, setExpand] = useState<Record<number, boolean>>({});
  const [over, setOver] = useState<number | null>(null);
  const f = filters.value;
  const set = (p: Partial<typeof f>) => (filters.value = { ...f, ...p });
  const placeOk = (x: T) => (f.place === 'all' ? true : f.place ? inPlace(x, f.place) : scope.value === 'all' || inPlace(x));
  const all = [...tasks.value.values()].filter(x => isOpen(x) && !isObligation(x));
  const oblig = [...tasks.value.values()].filter(x => x.status === 'open' && isObligation(x) && placeOk(x)).sort((a, b) => (a.at || '99').localeCompare(b.at || '99') || a.title.localeCompare(b.title));
  const q = f.q.trim().toLowerCase();
  const vis = all.filter(x => placeOk(x) && (!f.project || x.project === f.project) && (!f.suit || x.suit === f.suit) && (!q || x.title.toLowerCase().includes(q) || (x.note || '').toLowerCase().includes(q)));
  const hidden = all.filter(x => !placeOk(x)).length;
  const qs: Record<number, T[]> = { 1: [], 2: [], 3: [], 4: [] };
  vis.forEach(x => qs[quad(x)]!.push(x));
  Object.values(qs).forEach(a => a.sort(byPriority));
  const planSet = new Set(rawPlan(today.value));
  const projs = [...projects.value.values()].filter(p => p.status !== 'done' && p.status !== 'dropped');
  return (
    <div>
      {!f.place && <Scope hidden={hidden} />}
      <CommandBox scope={{ kind: 'matrix' }} />
      <div class="filters" data-testid="filters">
        <input type="search" value={f.q} placeholder={t('search')} aria-label={t('search')} onInput={e => set({ q: (e.target as HTMLInputElement).value })} />
        <select aria-label={t('project')} value={f.project} onChange={e => set({ project: (e.target as HTMLSelectElement).value })}>
          <option value="">{t('allProjects')}</option>{projs.map(p => <option value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label={t('suit')} value={f.suit} onChange={e => set({ suit: (e.target as HTMLSelectElement).value })}>
          <option value="">{t('allSuits')}</option>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}
        </select>
        <select aria-label={t('where')} value={f.place} onChange={e => set({ place: (e.target as HTMLSelectElement).value })}>
          <option value="">{t('thisPage')}</option><option value="all">{t('everything')}</option>
          {[...placeIds(), 'any'].map(id => <option value={id}>{placeName(id)}</option>)}
        </select>
      </div>
      <div class="matrix">
        {([1, 2, 3, 4] as Quadrant[]).map(k => {
          const items = qs[k]!, shown = expand[k] ? items : items.slice(0, 8);
          return (
            <section class={'quad' + (over === k ? ' over' : '')} data-testid={'quad' + k}
              onDragOver={e => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)}
              onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer?.getData('text/plain'); if (id) moveToQuadrant(id, k); }}>
              <h3>{quadName(k)} <small>{t(META[k]![0])}</small><span class="count">{items.length}</span></h3>
              <p class="hint">{t(META[k]![1])}</p>
              <ul class="items">{shown.map(x => <li key={x.id}><Item tk={x} planned={planSet.has(x.id)} /></li>)}</ul>
              {items.length > 8 && !expand[k] && <button class="btn ghost small" type="button" onClick={() => setExpand({ ...expand, [k]: true })}>{t('showAll', { n: items.length })}</button>}
            </section>
          );
        })}
      </div>
      {oblig.length > 0 && (
        <details class="more obligations" data-testid="obligations">
          <summary>{t('obligationsTitle')} · {oblig.length}</summary>
          <p class="hint">{t('obligationsHint')}</p>
          <ul class="items">{oblig.map(x => (
            <li key={x.id}><div class="item"><Suit s={x.suit} /><button type="button" class="linklike t" onClick={() => openTask(x.id)}><Title s={x.title} /></button><span class="ictrls">{x.at && <span class="due">{x.at}</span>}</span></div></li>
          ))}</ul>
        </details>
      )}
      <p class="hint axis-note">{t('axisNote')} {t('moveHint')}</p>
    </div>
  );
}
