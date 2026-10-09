// Break it down (brief §5, METHOD rule 5): the first action, where and with what; the starter
// test; an estimate; then the steps that follow, each waiting for the one before.
import { useState } from 'preact/hooks';
import { T, personal } from '../app/model';
import { patchTask, createTask, newTaskDoc } from '../app/actions';
import { openSheet, closeSheet } from '../app/sheet';
import { toast } from '../app/store';
import { Title, basisLine, learningLine } from '../app/ui';
import { t, fmtMin } from '../i18n';

export function openBreakDown(id: string) {
  openSheet(<BreakDown key={'bd' + id + Date.now()} id={id} />, true);
}

function BreakDown({ id }: { id: string }) {
  const tk = T(id);
  const [screen, setScreen] = useState(0);
  const [title, setTitle] = useState('');
  const [app, setApp] = useState(tk?.app ?? '');
  const [starter, setStarter] = useState(tk?.starter ?? '');
  const [checks, setChecks] = useState([false, false, false]);
  const [est, setEst] = useState('');
  const [next, setNext] = useState<{ title: string; est: string }[]>([]);
  const [draft, setDraft] = useState({ title: '', est: '' });
  if (!tk) return null;
  const typed = Number(est) || null;
  const pe = typed ? personal({ ...tk, est: typed, app: app || tk.app }) : null;

  const finish = async () => {
    const original = tk.title;
    const chain = next.filter(n => n.title.trim());
    // The step itself becomes the first action; it keeps its place on any day's list.
    await patchTask(id, {
      title: title.trim(), starter: starter.trim() || null, app: app.trim() || null, est: typed, estBy: typed ? 'me' : null,
      note: [tk.note, original !== title.trim() ? t('partOf', { title: original }) : ''].filter(Boolean).join('\n'),
    });
    let prev = id;
    for (const n of chain) {
      prev = await createTask(newTaskDoc(n.title.trim(), tk.suit, tk.project, {
        where: tk.where, est: Number(n.est) || null, estBy: Number(n.est) ? 'me' : null, after: prev, important: tk.important, due: tk.due, order: (tk.order || 0) + 1 + chain.indexOf(n),
      }));
    }
    closeSheet();
    toast(t('brokenDown', { n: chain.length + 1 }));
  };

  const screens = [
    <div data-testid="bd-first">
      <h3>{t('bdFirst')}</h3>
      <p class="hint">{t('bdFirstHint')}</p>
      <p class="quote"><Title s={tk.title} /></p>
      <label class="field"><span>{t('bdFirstAction')}</span><input type="text" value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} placeholder={t('newStepPlaceholder')} autocomplete="off" autoFocus /></label>
      <label class="field"><span>{t('bdWhere')}</span><input type="text" value={app} onInput={e => setApp((e.target as HTMLInputElement).value)} placeholder="Mail, Doctolib, the desk…" autocomplete="off" /></label>
      <div class="actions"><button class="btn primary" type="button" disabled={!title.trim()} onClick={() => setScreen(1)}>{t('next_')}</button></div>
    </div>,
    <div data-testid="bd-starter">
      <h3>{t('bdStarter')}</h3>
      <p class="hint">{t('bdStarterHint')}</p>
      <label class="field"><span>{t('starterField')}</span><input type="text" value={starter} onInput={e => setStarter((e.target as HTMLInputElement).value)} placeholder={t('starterPh')} autocomplete="off" /></label>
      <div class="field"><span>{t('bdTest')}</span>
        <div class="checks">{(['bdTest1', 'bdTest2', 'bdTest3'] as const).map((k, i) => (
          <label class="tog"><input type="checkbox" checked={checks[i]} onChange={e => { const c = [...checks]; c[i] = (e.target as HTMLInputElement).checked; setChecks(c); }} /> {t(k)}</label>
        ))}</div>
      </div>
      {starter.trim() && !(checks[0] && checks[1]) && <p class="hint">{t('bdGoSmaller')}</p>}
      {starter.trim() && checks[0] && checks[1] && !checks[2] && <p class="hint">{t('bdGoFurther')}</p>}
      <div class="actions">
        <button class="btn ghost" type="button" onClick={() => setScreen(0)}>{t('back')}</button>
        <button class="btn primary" type="button" disabled={!starter.trim() || checks.some(c => !c)} onClick={() => setScreen(2)}>{t('next_')}</button>
      </div>
    </div>,
    <div data-testid="bd-estimate">
      <h3>{t('bdEstimate')}</h3>
      <p class="hint">{t('estimateHint')}</p>
      <label class="field"><span>{t('estimateField')}</span><input type="number" min="1" max="600" inputMode="numeric" value={est} onInput={e => setEst((e.target as HTMLInputElement).value)} /></label>
      {typed && <p class="hint pe">{pe && pe.value !== typed ? t('estUsually', { a: fmtMin(typed), b: fmtMin(pe.value), lo: fmtMin(pe.lo), hi: fmtMin(pe.hi) }) + ' · ' + basisLine({ ...tk, est: typed }) : pe ? '' : learningLine()}</p>}
      {typed && typed > 30 && <p class="hint">{t('bdStillBig')}</p>}
      <div class="actions">
        <button class="btn ghost" type="button" onClick={() => setScreen(1)}>{t('back')}</button>
        <button class="btn primary" type="button" onClick={() => setScreen(3)}>{t('next_')}</button>
      </div>
    </div>,
    <div data-testid="bd-next">
      <h3>{t('bdNext')}</h3>
      <p class="hint">{t('bdNextHint')}</p>
      <ol class="mini">
        <li><span><b>{title}</b>{typed ? ' · ' + fmtMin(typed) : ''}</span></li>
        {next.map((n, i) => <li><span>{n.title}{Number(n.est) ? ' · ' + fmtMin(Number(n.est)) : ''}</span><button type="button" class="chip-x" onClick={() => setNext(next.filter((_, j) => j !== i))} aria-label={t('remove', { what: n.title })}>×</button></li>)}
      </ol>
      <form class="addstep" onSubmit={e => { e.preventDefault(); if (draft.title.trim()) { setNext([...next, draft]); setDraft({ title: '', est: '' }); } }}>
        <input type="text" value={draft.title} onInput={e => setDraft({ ...draft, title: (e.target as HTMLInputElement).value })} placeholder={t('nextStepPlaceholder')} aria-label={t('bdThen')} autocomplete="off" />
        <input type="number" min="1" max="600" value={draft.est} onInput={e => setDraft({ ...draft, est: (e.target as HTMLInputElement).value })} placeholder={t('minShort')} aria-label={t('estimateMin')} />
        <button class="btn small" type="submit">{t('add')}</button>
      </form>
      <div class="actions">
        <button class="btn ghost" type="button" onClick={() => setScreen(2)}>{t('back')}</button>
        <button class="btn primary" type="button" onClick={() => void finish()} data-testid="bd-finish">{t('bdFinish', { n: next.length + 1 })}</button>
      </div>
    </div>,
  ];
  return <div class="flow">{screens[screen]}</div>;
}
