// I'm stuck (brief §5, METHOD "Stuck in the middle of the day"): which step, which friction,
// the resume note or the starter, a smaller starter if needed, then the timer again.
// A second stall on the same step turns it into a question to someone, or a decision.
import { useState } from 'preact/hooks';
import { today, toast } from '../app/store';
import { T, planOf, isOpen, running } from '../app/model';
import { patchTask, startTask, createTask, newTaskDoc, setFirst } from '../app/actions';
import { openSheet, closeSheet } from '../app/sheet';
import { Title } from '../app/ui';
import { openDecision } from './decision';
import { t, type Key } from '../i18n';
import { ask as askAi } from '../ai/ask';
import { StuckReply } from '../ai/features';
import { stuckPrompt } from '../ai/prompts';
import { useAi, AiAction } from '../ai/ui';

export function openStuck(id?: string) {
  openSheet(<Stuck key={'stuck' + Date.now()} id={id} />, true);
}

const FRICTIONS: [string, Key, Key][] = [
  ['start', 'frStart', 'frStartHint'],
  ['restart', 'frRestart', 'frRestartHint'],
  ['drift', 'frDrift', 'frDriftHint'],
];

function Stuck({ id: given }: { id?: string }) {
  const steps = planOf(today.value).map(id => T(id)).filter(isOpen);
  const [id, setId] = useState<string | null>(given ?? running()?.id ?? (steps.length === 1 ? steps[0]!.id : null));
  const [friction, setFriction] = useState<string | null>(null);
  const [smaller, setSmaller] = useState('');
  const [ask, setAsk] = useState(false);
  const [who, setWho] = useState('');
  const ai = useAi();
  const [aiNote, setAiNote] = useState<string | null>(null);
  const tk = id ? T(id) : undefined;

  if (!tk) return (
    <div class="flow" data-testid="stuck-which">
      <h3>{t('stuckWhich')}</h3>
      <ul class="picklist">{steps.map(x => <li><div><p><Title s={x.title} /></p></div><button class="btn small" type="button" onClick={() => setId(x.id)}>{t('choose')}</button></li>)}</ul>
      {!steps.length && <p class="hint">{t('stuckNothing')}</p>}
    </div>
  );

  if (!friction) return (
    <div class="flow" data-testid="stuck-friction">
      <h3>{t('stuckFriction')}</h3>
      <p class="quote"><Title s={tk.title} /></p>
      <div class="bigchoices">{FRICTIONS.map(([v, k, h]) => (
        <button type="button" class="btn" onClick={() => { setFriction(v); void patchTask(tk.id, { stalls: (tk.stalls || 0) + 1, friction: [...(tk.friction ?? []), v] }); }}>
          <b>{t(k)}</b><small>{t(h)}</small>
        </button>
      ))}</div>
    </div>
  );

  const second = (tk.stalls || 0) >= 2;
  // The AI only fills the field: the person accepts it by restarting, or edits it first.
  const suggest = async () => {
    const { system, user } = stuckPrompt(tk.id, friction);
    const r = await ai.run(signal => askAi('stuck', 'quick', system, user, StuckReply, { signal }));
    if (r) { setSmaller(r.starter); setAiNote(r.note); }
  };
  const restart = async () => {
    if (smaller.trim()) await patchTask(tk.id, { starter: smaller.trim() });
    closeSheet();
    if (!tk.started) await startTask(tk.id);
    toast(t('stuckRestarted'));
  };
  const toQuestion = async () => {
    const q = await createTask(newTaskDoc(t('askWho', { who: who.trim() || '…', title: tk.title }), tk.suit, tk.project, { where: tk.where, est: 5, estBy: 'me', starter: t('askStarter'), app: 'Messages' }));
    const after = Array.isArray(tk.after) ? tk.after : tk.after ? [String(tk.after)] : [];
    await patchTask(tk.id, { after: [...after, q] });
    await setFirst(q);
    closeSheet();
  };

  return (
    <div class="flow" data-testid="stuck-starter">
      <h3><Title s={tk.title} /></h3>
      {friction !== 'start' && tk.resume ? <p class="resume">{t('resume', { text: tk.resume })}</p> : null}
      <p class="starter big">{tk.starter ? t('starterIs', { s: tk.starter }) : t('noStarterYet')}</p>
      <p class="hint">{t(friction === 'drift' ? 'stuckDriftHint' : 'stuckStarterHint')}</p>
      <label class="field"><span>{t('smallerStarter')}</span><input type="text" value={smaller} onInput={e => { setSmaller((e.target as HTMLInputElement).value); setAiNote(null); }} placeholder={t('starterPh')} autocomplete="off" data-testid="stuck-smaller" /></label>
      {aiNote != null ? <p class="hint" data-testid="stuck-ai-note">{t('aiStarterProposed')}{aiNote ? ' ' + aiNote : ''}</p>
        : <AiAction ai={ai} label={t('aiSmallerStarter')} onClick={() => void suggest()} testid="ai-stuck" />}
      <div class="actions"><button class="btn primary" type="button" onClick={() => void restart()} data-testid="stuck-restart">{tk.started ? t('backToIt') : t('restartTimer')}</button></div>
      {second && (
        <div class="notice" data-testid="stuck-second">
          <p><b>{t('stalledAgain')}</b></p>
          <p class="hint">{t('stalledAgainHint')}</p>
          {ask ? (
            <div class="row-inline" style="margin-top:10px">
              <input type="text" value={who} onInput={e => setWho((e.target as HTMLInputElement).value)} placeholder={t('askWhoPh')} aria-label={t('askWhoPh')} />
              <button class="btn small" type="button" onClick={() => void toQuestion()}>{t('add')}</button>
            </div>
          ) : (
            <div class="actions">
              <button class="btn" type="button" onClick={() => setAsk(true)}>{t('toQuestion')}</button>
              <button class="btn" type="button" onClick={() => { void patchTask(tk.id, { kind: 'decision' }); openDecision(null, { taskId: tk.id }); }}>{t('toDecision')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
