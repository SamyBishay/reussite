// The Eisenhower matrix (brief §5): four boxes, each showing its first two cards and a button for the rest, and the whole
// list folded at the bottom. Moves: drag on desktop and tablet; on phones, long-press or the "Move to…" menu. What is
// shown follows the place menu's View (the page's place, one of its areas, or everywhere).
import { Cemetery } from './Cemetery';
import { useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { tasks, today, settings, projects } from '../app/store';
import { isOpen, isObligation, inPlace, quad, byPriority, rawPlan, blocked, type T } from '../app/model';
import { ChainFold } from '../app/ChainFold';
import { openTask, openMove, moveToQuadrant } from '../app/sheets';
import { Title, Suit, quadName, DueChip, suitName, openSheet } from '../app/ui';
import { Fold } from '../app/More';
import { t, type Key } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import type { Quadrant } from '../domain/tasks';
import { CommandBox } from '../ai/ui';
import { openDecision } from '../flows/decision';
import { AreaTag } from '../app/AreaUi';
import { areaOfStep, showsInArea } from '../app/areas';

const META: Record<number, [Key, Key]> = { 1: ['qNowSub', 'qNowHint'], 2: ['qProtectSub', 'qProtectHint'], 3: ['qQuickSub', 'qQuickHint'], 4: ['qLaterSub', 'qLaterHint'] };
const QUADS: Quadrant[] = [1, 2, 3, 4];
/** How many cards a box shows before "View all". */
const PEEK = 2;
/** The search and the project and suit filters of the folded list of every card. */
const filters = signal({ q: '', project: '', suit: '' });

/** The open cards on the page (the view's place and area), and in each quadrant in priority order. */
function pageCards(): { all: T[]; qs: Record<number, T[]> } {
  // A step that waits for another is inside its head's card ("+n after"), not a card of its own.
  const all = [...tasks.value.values()].filter(x => isOpen(x) && !isObligation(x) && !blocked(x) && inPlace(x) && showsInArea('matrix', x));
  const qs: Record<number, T[]> = { 1: [], 2: [], 3: [], 4: [] };
  all.forEach(x => qs[quad(x)]!.push(x));
  Object.values(qs).forEach(a => a.sort(byPriority));
  return { all, qs };
}

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

function Item({ tk, planned, quadTag }: { tk: T; planned: boolean; quadTag?: Quadrant }) {
  const lp = useLongPress(() => openMove(tk.id));
  const { wasLong, ...handlers } = lp;
  return (
    <div class="item" draggable data-task={tk.id} onDragStart={e => { e.dataTransfer?.setData('text/plain', tk.id); (e.currentTarget as HTMLElement).classList.add('dragging'); }}
      onDragEnd={e => (e.currentTarget as HTMLElement).classList.remove('dragging')}>
      <Suit s={tk.suit} />
      <div class="item-body">
        <button type="button" class="linklike t" {...handlers} onClick={() => { if (!wasLong()) openTask(tk.id); }}>
          <Title s={tk.title} />
          {tk.kind === 'decision' && <> <span class="tag">{t('decisionTag')}</span></>}
          {planned && <> <span class="tag today">{t('today')}</span></>}
          {quadTag && <> <span class={'tag quadtag q' + quadTag} data-testid="quad-tag">{quadName(quadTag)}</span></>}
          {areaOfStep(tk) && <> <AreaTag id={areaOfStep(tk)!} /></>}
        </button>
        <ChainFold tk={tk} />
      </div>
      <span class="ictrls">
        <DueChip tk={tk} />
        {tk.kind === 'decision' && <button type="button" class="icon-btn sm" onClick={() => void openDecision(null, { taskId: tk.id })} aria-label={t('openDecision')} data-testid="matrix-decision">⚖</button>}
        <button type="button" class="icon-btn sm" onClick={() => openMove(tk.id)} aria-label={t('moveTo')} data-testid="move-btn">⇄</button>
      </span>
    </div>
  );
}

/** The whole of one quadrant, in a sheet. */
function QuadSheet({ k }: { k: Quadrant }) {
  const items = pageCards().qs[k]!;
  const planSet = new Set(rawPlan(today.value));
  return (
    <div class={'quadsheet q' + k} data-testid="quad-sheet">
      <h3>{quadName(k)} <small>{t(META[k]![0])}</small></h3>
      {items.length === 0 ? <p class="hint">{t(META[k]![1])}</p> : <ul class="items">{items.map(x => <li key={x.id}><Item tk={x} planned={planSet.has(x.id)} /></li>)}</ul>}
    </div>
  );
}

/** One quadrant: its name, what it means, how many, the first two cards and a button for the rest. A card dropped on it moves there. */
function Box({ k, items, planSet, over, setOver }: { k: Quadrant; items: T[]; planSet: Set<string>; over: number | null; setOver: (k: number | null) => void }) {
  return (
    <section class={'quad q' + k + (over === k ? ' over' : '')} data-testid={'quad' + k} aria-label={quadName(k)}
      onDragOver={e => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)}
      onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer?.getData('text/plain'); if (id) moveToQuadrant(id, k); }}>
      <header class="quad-h">
        <h3>{quadName(k)}</h3>
        <span class="count" data-testid={'quad-count' + k}>{items.length}</span>
        <small>{t(META[k]![0])}</small>
      </header>
      {items.length === 0
        ? <p class="hint quad-empty">{t(META[k]![1])}</p>
        : <ul class="items">{items.slice(0, PEEK).map(x => <li key={x.id}><Item tk={x} planned={planSet.has(x.id)} /></li>)}</ul>}
      {items.length > PEEK && <button class="btn ghost small quad-more" type="button" data-testid={'quad-all' + k} onClick={() => openSheet(<QuadSheet k={k} />)}>{t('viewAllN', { n: items.length })}</button>}
    </section>
  );
}

/** Every card in one list with its quadrant named, searchable and filtered by project and suit. Built only while its fold is open. */
function AllCards({ qs, planSet }: { qs: Record<number, T[]>; planSet: Set<string> }) {
  const f = filters.value;
  const set = (p: Partial<typeof f>) => (filters.value = { ...f, ...p });
  const projs = [...projects.value.values()].filter(p => p.status !== 'done' && p.status !== 'dropped');
  const q = f.q.trim().toLowerCase();
  const list = QUADS.flatMap(k => qs[k]!.map(x => [k, x] as const))
    .filter(([, x]) => (!f.project || x.project === f.project) && (!f.suit || x.suit === f.suit) && (!q || x.title.toLowerCase().includes(q) || (x.note || '').toLowerCase().includes(q)));
  return (
    <div class="allcards">
      <div class="filters" data-testid="filters">
        <input type="search" value={f.q} placeholder={t('search')} aria-label={t('search')} onInput={e => set({ q: (e.target as HTMLInputElement).value })} />
        <select aria-label={t('project')} value={f.project} onChange={e => set({ project: (e.target as HTMLSelectElement).value })}>
          <option value="">{t('allProjects')}</option>{projs.map(p => <option value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label={t('suit')} value={f.suit} onChange={e => set({ suit: (e.target as HTMLSelectElement).value })}>
          <option value="">{t('allSuits')}</option>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}
        </select>
      </div>
      {list.length === 0 ? <p class="hint">{t('allCardsNone')}</p> : <ul class="items" data-testid="all-cards-list">{list.map(([k, x]) => <li key={x.id}><Item tk={x} planned={planSet.has(x.id)} quadTag={k} /></li>)}</ul>}
    </div>
  );
}

export function Matrix() {
  const [over, setOver] = useState<number | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const { all, qs } = pageCards();
  const oblig = [...tasks.value.values()].filter(x => x.status === 'open' && isObligation(x) && inPlace(x)).sort((a, b) => (a.at || '99').localeCompare(b.at || '99') || a.title.localeCompare(b.title));
  const planSet = new Set(rawPlan(today.value));
  return (
    <div>
      <CommandBox scope={{ kind: 'matrix' }} />
      <div class="matrix" data-testid="matrix">
        {QUADS.map(k => <Box key={k} k={k} items={qs[k]!} planSet={planSet} over={over} setOver={setOver} />)}
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
      <Fold title={t('allCardsTitle', { n: all.length })} testid="all-cards" onToggle={setAllOpen}>
        {allOpen && <AllCards qs={qs} planSet={planSet} />}
      </Fold>
      <Cemetery />
      <p class="hint axis-note">{t('axisNote')} {t('moveHint')}</p>
    </div>
  );
}
