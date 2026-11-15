// The quick deal (2026-11-15): Deal the day for a new install, on one screen. Up to three cards and one for leisure or people, each kept or
// swapped with a tap, then Deal. The cards are the planner's (src/domain/planner.ts, through the ritual's `planInput`), topped up from the deck in
// its usual order when the planner leaves room; the leisure card is the standing item done least recently (Leisure & people), else a card of the
// second or fourth suit. It deals through the ritual's own `dealHand`, and the whole ritual (src/flows/checkin.tsx) is one tap away.
import { useState } from 'preact/hooks';
import { today, settings } from '../app/store';
import { T } from '../app/model';
import { openSheet, closeSheet } from '../app/sheet';
import { Title, Suit } from '../app/ui';
import { go } from '../app/nav';
import { plan as makePlan, type PlanItem } from '../domain/planner';
import { withTime } from '../domain/calendar';
import type { SuitId } from '../data/schema';
import { planInput, startNow, dealHand, openCheckin } from './checkin';
import { t } from '../i18n';

export const openQuickDeal = () => openSheet(<QuickDeal key={'qd' + Date.now()} />, true);

/** How many cards the quick deal proposes, besides the one for leisure or people. */
export const HAND = 3;
/** The suits a leisure-or-people card comes from when there is no standing item: Leisure and Interpersonal obligations in a new install's four. */
const LEISURE: SuitId[] = ['D', 'H'];

interface Row { item: PlanItem; kept: boolean; leisure: boolean }
interface Seed { fixed: PlanItem[]; rows: Row[]; work: string[]; leisure: PlanItem[] }

function seed(k: string): Seed {
  const inp = planInput(k, { start: startNow(), preset: 'normal', fixed: [] });
  const p = makePlan({ ...inp, maxWorkSteps: Math.min(HAND, inp.maxWorkSteps) });
  const fixed = p.items.filter(i => i.role === 'fixed');
  // Every card that could be dealt, in the order they would be offered: what is already on the day, then the deck by priority.
  const work = [...inp.carried, ...inp.candidates].map(s => s.id).filter((id, i, a) => a.indexOf(id) === i);
  const picked = p.items.filter(i => i.role === 'carried' || i.role === 'now' || i.role === 'protect' || i.role === 'quick').slice(0, HAND);
  for (const id of work) { if (picked.length >= HAND) break; if (!picked.some(i => i.id === id)) picked.push({ id, role: 'quick' }); }
  // For leisure or people: standing items, done least recently first (the planner's own pick first), then cards of those suits.
  const obs = [...inp.obligations].sort((a, b) => (a.lastDone ?? '').localeCompare(b.lastDone ?? ''));
  const leisure: PlanItem[] = [
    ...obs.map(o => ({ id: o.id, role: 'obligation' as const, at: o.at || settings.value.obligationAt })),
    ...work.filter(id => LEISURE.includes(T(id)?.suit as SuitId)).map(id => ({ id, role: 'quick' as const })),
  ];
  const ob = p.items.find(i => i.role === 'obligation');
  const fun = (ob && leisure.find(l => l.id === ob.id)) ?? leisure.find(l => !picked.some(i => i.id === l.id));
  const rows: Row[] = [...picked.map(item => ({ item, kept: true, leisure: false })), ...(fun ? [{ item: fun, kept: true, leisure: true }] : [])];
  return { fixed, rows, work, leisure };
}

function QuickDeal() {
  const k = today.value;
  const [s] = useState(() => seed(k));
  const [rows, setRows] = useState<Row[]>(s.rows);
  const [busy, setBusy] = useState(false);
  const shown = new Set(rows.map(r => r.item.id));
  /** The next card for this row: after the one it shows, not one already in the hand; round again at the end. */
  const nextFor = (r: Row): PlanItem | null => {
    const pool = r.leisure ? s.leisure : s.work.map(id => ({ id, role: 'quick' as const }));
    const at = pool.findIndex(x => x.id === r.item.id);
    for (let i = 1; i <= pool.length; i++) { const x = pool[(at + i) % pool.length]!; if (!shown.has(x.id)) return x; }
    return null;
  };
  const set = (i: number, r: Row) => setRows(rows.map((x, j) => (j === i ? r : x)));
  const kept = rows.filter(r => r.kept);
  const deal = async () => {
    setBusy(true);
    await dealHand(k, [...s.fixed, ...kept.map(r => r.item)]);
    closeSheet();
    go('today');
  };
  return (
    <div class="flow quickdeal" data-testid="quick-deal">
      <h3>{t('qdTitle')}</h3>
      <p class="hint">{t('qdHint')}</p>
      {s.fixed.length > 0 && (
        <ul class="picklist qd-fixed">{s.fixed.map(f => { const x = T(f.id); return x ? <li data-testid="qd-fixed"><span class="tag">{t('roleFixed')}</span><span><Title s={withTime(x.title, f.at ?? '')} /></span></li> : null; })}</ul>
      )}
      {rows.length ? (
        <ul class="picklist" data-testid="qd-list">{rows.map((r, i) => {
          const x = T(r.item.id);
          if (!x) return null;
          const next = nextFor(r);
          return (
            <li key={r.leisure ? 'leisure' : 'c' + i} class={r.kept ? '' : 'qd-off'} data-testid={r.leisure ? 'qd-leisure' : 'qd-row'}>
              <div><p><Suit s={x.suit} /> {r.kept ? <Title s={x.title} /> : <s><Title s={x.title} /></s>}</p>{r.leisure && <p class="meta">{t('qdLeisure')}</p>}</div>
              <div class="go">
                <button class="btn small" type="button" aria-pressed={r.kept} onClick={() => set(i, { ...r, kept: !r.kept })} data-testid="qd-keep">{t('qdKeep')}</button>
                <button class="btn small ghost" type="button" disabled={!next} onClick={() => next && set(i, { ...r, item: next, kept: true })} data-testid="qd-swap">{t('swap')}</button>
              </div>
            </li>
          );
        })}</ul>
      ) : <p class="hint" data-testid="qd-empty">{t('qdEmpty')}</p>}
      <div class="actions">
        <button class="btn primary" type="button" disabled={busy || (!kept.length && !s.fixed.length)} onClick={() => void deal()} data-testid="qd-deal">{t('qdDeal')}</button>
      </div>
      <button class="linklike qd-ritual" type="button" onClick={() => { closeSheet(); openCheckin(); }} data-testid="qd-ritual">{t('qdRitual')}</button>
    </div>
  );
}
