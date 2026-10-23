// Close the day (brief §5, "The close-of-day show"). Deal, don't parade: the day's cards are
// flicked in one at a time and land in a still tableau, readable at rest, with a firework
// behind each. Cards are DOM elements moved with transform only (crisp at any pixel density);
// only the fireworks canvas underneath gets the trail effect. Timed by the clock, not frames.
import { useEffect, useRef, useState } from 'preact/hooks';
import { today, settings } from '../app/store';
import { T, planOf, dayDoc, candidates, cardsOn, minutesOn, minutesOnFor, ratio, isOpen, type T as Tk } from '../app/model';
import { closeDay } from '../app/actions';
import { overlay, openSheet, closeSheet } from '../app/sheet';
import { rankOf } from '../app/sheets';
import { Title, Suit } from '../app/ui';
import { soundCard, soundChord } from '../app/celebrate';
import { t, fmtMin, fmtDate } from '../i18n';
import { addDays } from '../domain/dates';
import { SUIT_ORDER } from '../data/settings';

const motionOff = () => settings.value.reduceMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function openClose() {
  const cards = cardsOn(today.value);
  if (!cards.length || settings.value.celebrations === 'off') return openSheet(<Summary key={'close' + Date.now()} />);
  overlay.value = <Show key={'show' + Date.now()} />;
}
const endShow = () => { overlay.value = null; };

/** Seconds between cards: about 0.6–0.9 s each, the whole deal under ten seconds. */
export function dealPace(n: number): number {
  return Math.max(0.3, Math.min(0.8, 9 / Math.max(1, n)));
}

// ---------- fireworks (canvas, underneath) ----------
interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number }
function useFireworks(canvas: { current: HTMLCanvasElement | null }, on: boolean) {
  const ps = useRef<P[]>([]);
  const raf = useRef(0);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !on) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(3, devicePixelRatio || 1);
    const size = () => { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    addEventListener('resize', size);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--accent-deep').trim() || '#1D1830';
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // The trail veil applies to this canvas only; the cards above stay sharp.
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
      ctx.globalAlpha = 1;
      ps.current = ps.current.filter(p => (p.life += dt) < p.max);
      for (const p of ps.current) {
        p.vy += 160 * dt;
        p.vx *= 1 - 0.9 * dt;
        p.vy *= 1 - 0.9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); removeEventListener('resize', size); };
  }, [on]);
  /** A burst at (x, y). Deterministic: evenly spaced angles, no randomness. */
  return (x: number, y: number, colors: string[], n: number, speed = 150) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, s = speed * (0.6 + 0.4 * ((i * 7) % 5) / 4);
      ps.current.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.9 + ((i * 3) % 4) * 0.15, c: colors[i % colors.length]!, r: 1.6 + (i % 3) * 0.6 });
    }
  };
}

function Show() {
  const k = today.value;
  const cards = cardsOn(k);
  const reduce = motionOff();
  const lively = settings.value.celebrations === 'lively';
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const burst = useFireworks(canvas, !reduce);
  const [dealt, setDealt] = useState(0);
  const [finished, setFinished] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const speed = useRef(1);
  const skip = useRef(false);

  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>('.tcard')];
    const pace = dealPace(cards.length) * 1000;
    const colors = (s: string) => {
      const css = getComputedStyle(document.documentElement);
      return [css.getPropertyValue('--suit-' + s).trim() || '#fff', css.getPropertyValue('--lilac').trim(), css.getPropertyValue('--sea').trim(), '#F7F1E6'];
    };
    let i = 0, clock = 0, last = performance.now(), raf = 0;
    const land = (n: HTMLElement, idx: number) => {
      const r = n.getBoundingClientRect();
      if (!reduce) burst(r.left + r.width / 2, r.top + r.height / 2, colors(n.dataset.suit ?? 'S'), lively ? 26 : 12);
      soundCard(idx);
    };
    const deal = (idx: number, instant = false) => {
      const n = nodes[idx];
      if (!n) return;
      n.style.visibility = 'visible';
      if (instant) { n.style.opacity = '1'; return; }
      if (reduce) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' }); setTimeout(() => soundCard(idx), 0); return; }
      const r = n.getBoundingClientRect();
      const dx = Math.round(innerWidth / 2 - (r.left + r.width / 2)), dy = Math.round(innerHeight + 40 - r.top);
      const a = n.animate([
        { transform: `translate(${dx}px,${dy}px) rotate(${idx % 2 ? 8 : -8}deg) scale(.7)`, opacity: 0.4 },
        { transform: 'translate(0,-6px) rotate(0deg) scale(1.03)', opacity: 1, offset: 0.8 },
        { transform: 'none', opacity: 1 },
      ], { duration: Math.min(560, pace * 0.9) / speed.current, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'forwards' });
      a.onfinish = () => { a.cancel(); n.style.opacity = '1'; land(n, idx); };
    };
    const finish = () => {
      for (; i < nodes.length; i++) deal(i, true);
      setDealt(nodes.length);
      setFinished(true);
      soundChord(true);
      if (!reduce) {
        const c = colors('S');
        burst(innerWidth / 2, innerHeight * 0.3, c, lively ? 64 : 30, 240);
        setTimeout(() => burst(innerWidth * 0.25, innerHeight * 0.35, colors('H'), lively ? 36 : 16, 190), 220);
        setTimeout(() => burst(innerWidth * 0.75, innerHeight * 0.35, colors('D'), lively ? 36 : 16, 190), 420);
      }
    };
    const tick = (now: number) => {
      clock += (now - last) * speed.current;
      last = now;
      if (skip.current) return finish();
      while (i < nodes.length && clock >= i * pace) { deal(i); i++; setDealt(i); }
      if (i >= nodes.length && clock >= (nodes.length - 1) * pace + 700) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') endShow(); };
    addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', onKey); };
  }, []);

  let rank: Record<string, number> = {};
  return (
    <div class="show" role="dialog" aria-modal="true" aria-label={t('closeTitle')} data-testid="show" onClick={() => { if (!finished) speed.current = 4; }}>
      <canvas ref={canvas} aria-hidden="true" />
      <div class="show-top">
        <p class="eyebrow">{fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p class={'show-count' + (finished ? ' open' : '')} aria-live="polite">{dealt}<small>{t('cardsPlayed', { n: dealt })}</small></p>
        {!finished && <button class="btn small skip" type="button" onClick={e => { e.stopPropagation(); skip.current = true; }} data-testid="skip">{t('skip')}</button>}
      </div>
      <div class="tableau-show" ref={grid}>
        {cards.map(c => {
          rank = { ...rank, [c.suit]: (rank[c.suit] ?? 0) + 1 };
          const m = minutesOnFor(k, c.id);
          return (
            <div class={'tcard suit-' + c.suit} data-suit={c.suit} style="visibility:hidden;opacity:0">
              <span class="tr">{rankOf(rank[c.suit]!)}<Suit s={c.suit} /></span>
              <span class="tt"><Title s={c.title} /></span>
              {m > 0 && <span class="tm">{fmtMin(m)}</span>}
            </div>
          );
        })}
      </div>
      {finished && (
        <div class={'show-summary' + (showSummary ? '' : ' folded')} onClick={e => e.stopPropagation()} data-testid="show-summary">
          <button class="btn small ghost fold" type="button" onClick={() => setShowSummary(!showSummary)}>{showSummary ? t('lookAtDay') : t('showSummary')}</button>
          {showSummary && <Summary inShow />}
        </div>
      )}
    </div>
  );
}

/** The day's summary, then tomorrow's first step and optional start time. */
function Summary({ inShow = false }: { inShow?: boolean }) {
  const k = today.value;
  const deck = cardsOn(k);
  const by: Record<string, number> = { S: 0, D: 0, C: 0, H: 0 };
  deck.forEach(c => (by[c.suit] = (by[c.suit] ?? 0) + 1));
  const r = ratio.value;
  const td = dayDoc(addDays(k, 1));
  const sugg: Tk[] = planOf(k).map(id => T(id)!).filter(isOpen);
  candidates().forEach(c => { if (sugg.length < 8 && !sugg.includes(c)) sugg.push(c); });
  const startL = td?.launches?.find(l => l.first);
  const [sel, setSel] = useState(td?.first?.id ?? '');
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const v = (n: string) => ((f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '');
    if (inShow) endShow(); else closeSheet();
    void closeDay(sel && sel !== '__new' ? sel : null, sel === '__new' ? v('newTitle') : '', v('time'));
  };
  return (
    <form onSubmit={submit} class="summary-form" data-testid="close-summary">
      {!inShow && <p class="eyebrow">{fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}</p>}
      {!inShow && <h3 style="font-size:56px;line-height:1;margin-top:var(--s2)">{deck.length}</h3>}
      {!inShow && <p class="bigsub">{t('cardsPlayed', { n: deck.length })}</p>}
      <div class="minifound">{SUIT_ORDER.map(s => <span><Suit s={s} /> {by[s]}</span>)}</div>
      <p class="meta" style="margin-top:var(--s2)">{t('timed', { t: fmtMin(minutesOn(k)) })}{r.v ? ' · ' + t('estimatesRun', { r: r.v.toFixed(1) }) : ''}</p>
      {!inShow && deck.length > 0 && <ul class="pilelist">{deck.map((c, i) => <li><span class={'rk suit-' + c.suit}>{rankOf(deck.slice(0, i + 1).filter(x => x.suit === c.suit).length)}</span><span><Title s={c.title} /></span><span class="tm" /></li>)}</ul>}
      <label class="field"><span>{t('tomorrowFirst')}</span>
        <select value={sel} onChange={e => setSel((e.target as HTMLSelectElement).value)}>
          <option value="">{t('chooseOne')}</option>
          {sugg.map(x => <option value={x.id}>{x.title}</option>)}
          <option value="__new">{t('writeNew')}</option>
        </select>
      </label>
      {sel === '__new' && <label class="field"><span>{t('newVerbFirst')}</span><input type="text" name="newTitle" autocomplete="off" /></label>}
      <label class="field"><span>{t('startAt')}</span><input type="time" name="time" defaultValue={startL?.t ?? ''} /></label>
      <div class="actions"><button class="btn primary" type="submit" data-testid="close-confirm">{t('closeTitle')}</button><button class="btn ghost" type="button" onClick={inShow ? endShow : closeSheet}>{t('notYet')}</button></div>
    </form>
  );
}
