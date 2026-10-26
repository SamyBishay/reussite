// The Log, ported from v1: totals, the last seven days, timed sessions. A mode of the Calendar.
import { sessions, tasks, today, settings } from '../app/store';
import { cardsOn, minutesOn, allCards, ratio, estPoints } from '../app/model';
import { medianRatio, closeness } from '../domain/estimates';
import { Title, suitName } from '../app/ui';
import { t, fmtMin, fmtDate, type Key } from '../i18n';
import { addDays } from '../domain/dates';
import { SUIT_ORDER } from '../data/settings';

const WHY: Record<string, Key> = { done: 'whyDone', later: 'whyLater', focus: 'whyFocus', blocked: 'whyBlocked', interrupted: 'whyInterrupted', tired: 'whyTired', switched: 'whySwitched', close: 'whyClose' };
const whyText = (w: string | null | undefined) => (w && WHY[w] ? t(WHY[w]!) : '');

/** Getting better at estimating is real progress: the median ratio by month and by app, and whose estimates land closer. */
function Calibration() {
  const pts = estPoints.value;
  if (!pts.length) return null;
  const x = (r: number | null) => (r == null ? '—' : '×' + r.toFixed(1));
  const byMonth = new Map<string, typeof pts>();
  for (const p of pts) { const m = p.doneDay.slice(0, 7); byMonth.set(m, [...(byMonth.get(m) ?? []), p]); }
  const byApp = new Map<string, typeof pts>();
  for (const p of pts) if (p.app) { const k = p.app.trim(); byApp.set(k, [...(byApp.get(k) ?? []), p]); }
  const mine = pts.filter(p => p.by !== 'ai'), ai = pts.filter(p => p.by === 'ai');
  const cm = closeness(mine), ca = closeness(ai);
  return (
    <>
      <h2 class="sec">{t('calibration')} <span class="hint-inline">{t('calibrationHint')}</span></h2>
      <div class="calib" data-testid="calibration">
        <table class="sess" style="min-width:0"><thead><tr><th>{t('month')}</th><th class="n">{t('timedN')}</th><th class="n">{t('realOverEst')}</th></tr></thead>
          <tbody>{[...byMonth].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).map(([m, xs]) => <tr><td>{fmtDate(m + '-01', { month: 'long', year: 'numeric' })}</td><td class="n">{xs.length}</td><td class="n">{x(medianRatio(xs))}</td></tr>)}</tbody></table>
        {byApp.size > 0 && <table class="sess" style="min-width:0"><thead><tr><th>{t('appField')}</th><th class="n">{t('timedN')}</th><th class="n">{t('realOverEst')}</th></tr></thead>
          <tbody>{[...byApp].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([a, xs]) => <tr><td>{a}</td><td class="n">{xs.length}</td><td class="n">{x(medianRatio(xs))}</td></tr>)}</tbody></table>}
      </div>
      {ai.length > 0 && cm != null && ca != null && <p class="hint" style="margin-top:var(--s2)">{cm <= ca ? t('yoursCloser', { me: x(medianRatio(mine)), ai: x(medianRatio(ai)) }) : t('aiCloser', { me: x(medianRatio(mine)), ai: x(medianRatio(ai)) })}</p>}
    </>
  );
}

export function Log() {
  const r = ratio.value;
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const k = addDays(today.value, -i);
    const cs = cardsOn(k);
    const by: Record<string, number> = { S: 0, D: 0, C: 0, H: 0 };
    cs.forEach(c => (by[c.suit] = (by[c.suit] ?? 0) + 1));
    week.push({ k, n: cs.length, by, m: minutesOn(k) });
  }
  const wk = week.reduce((a, b) => a + b.m, 0);
  const max = Math.max(4, ...week.map(w => w.n));
  const sess = [...sessions.value.values()].filter(s => tasks.value.get(s.taskId)?.status !== 'dropped').sort((a, b) => String(b.at || b.d || '').localeCompare(String(a.at || a.d || '')));
  const friction: Record<string, number> = {};
  sess.forEach(s => { const w = s.why; if (w && w !== 'done' && w !== 'switched' && w !== 'close') friction[w] = (friction[w] ?? 0) + 1; });
  const fk = Object.keys(friction).sort((a, b) => friction[b]! - friction[a]!);

  return (
    <div>
      <div class="stats">
        <div class="stat"><b>{allCards()}</b><span>{t('cardsPlayedAllTime')}</span></div>
        <div class="stat"><b>{fmtMin(wk)}</b><span>{t('timedLast7')}</span></div>
        <div class="stat"><b>{r.v ? '×' + r.v.toFixed(1) : '—'}</b><span>{r.v ? t('ratioLabel', { n: r.n }) : t('ratioNeed', { n: 3 - r.n })}</span></div>
      </div>
      <h2 class="sec">{t('last7')}</h2>
      <div class="week" role="img" aria-label={t('last7Label')}>
        {week.map(w => (
          <div class={'wcol' + (w.k === today.value ? ' today' : '')}>
            <div class="wbar"><div class="wstack" style={{ height: Math.round((w.n / max) * 100) + '%' }}>
              {SUIT_ORDER.map(s => (w.by[s] ? <i class={s} style={{ flex: w.by[s] }} /> : null))}
            </div></div>
            <b>{w.n || ''}</b><small>{fmtDate(w.k, { weekday: 'short' })}</small>
          </div>
        ))}
      </div>
      <p class="legend">{SUIT_ORDER.map(s => <span><i class={'sw ' + s} />{settings.value.suits[s].glyph} {suitName(s, true)}</span>)}</p>
      <h2 class="sec">{t('timedSessions')}</h2>
      {sess.length ? (
        <>
          {fk.length > 0 && <p class="friction">{t('stoppedEarly', { list: fk.map(k => whyText(k) + ' ' + friction[k]).join(' · ') })}</p>}
          <div class="tablewrap"><table class="sess">
            <thead><tr><th>{t('day')}</th><th>{t('step')}</th><th class="n">{t('estimate')}</th><th class="n">{t('real')}</th><th>{t('stoppedBecause')}</th></tr></thead>
            <tbody>{sess.slice(0, 20).map(s => {
              const tk = tasks.value.get(s.taskId);
              const est = tk?.est0 ?? tk?.est;
              return <tr><td class="n">{fmtDate(s.d)}</td><td>{tk ? <Title s={tk.title} /> : '—'}</td><td class="n">{est ? fmtMin(est) : '—'}</td><td class="n">{fmtMin(s.m)}</td><td>{whyText(s.why)}</td></tr>;
            })}</tbody>
          </table></div>
        </>
      ) : <p class="hint">{t('nothingTimed')}</p>}
      <Calibration />
    </div>
  );
}
