// The Log, ported from v1: totals, the last seven days, timed sessions, decisions.
import { sessions, tasks, today, decisions, settings } from '../app/store';
import { cardsOn, minutesOn, allCards, ratio } from '../app/model';
import { Title, suitName } from '../app/ui';
import { t, fmtMin, fmtDate, type Key } from '../i18n';
import { addDays } from '../domain/dates';
import { SUIT_ORDER } from '../data/settings';

const WHY: Record<string, Key> = { done: 'whyDone', later: 'whyLater', focus: 'whyFocus', blocked: 'whyBlocked', interrupted: 'whyInterrupted', tired: 'whyTired', switched: 'whySwitched', close: 'whyClose' };
const whyText = (w: string | null | undefined) => (w && WHY[w] ? t(WHY[w]!) : '');

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
  const sess = [...sessions.value.values()].sort((a, b) => String(b.at || b.d || '').localeCompare(String(a.at || a.d || '')));
  const friction: Record<string, number> = {};
  sess.forEach(s => { const w = s.why; if (w && w !== 'done' && w !== 'switched' && w !== 'close') friction[w] = (friction[w] ?? 0) + 1; });
  const fk = Object.keys(friction).sort((a, b) => friction[b]! - friction[a]!);
  const decs = [...decisions.value.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

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
      <h2 class="sec">{t('decisions')}</h2>
      {decs.length ? (
        <ul class="decs">{decs.map(d => (
          <li>
            <p><b>{d.title}</b></p>
            <p class="meta">{typeof d.date === 'string' && fmtDate(d.date, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · '}{t('chosen', { what: String(d.chosen ?? '—') })}</p>
            {typeof d.falsifier === 'string' && d.falsifier && <p class="meta">{t('revisitIf', { what: d.falsifier })}{typeof d.reviewOn === 'string' && ' · ' + t('checkOn', { date: fmtDate(d.reviewOn) })}</p>}
          </li>
        ))}</ul>
      ) : <p class="hint">{t('noDecisions')}</p>}
    </div>
  );
}
