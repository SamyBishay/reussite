// AI on screen: "Show me what's sent", the command box, "Ask any AI" and "Paste the reply".
import { useEffect, useRef, useState } from 'preact/hooks';
import { openSheet, closeSheet } from '../app/ui';
import { projects, decisions, stays, people, toast } from '../app/store';
import { placeName } from '../app/sheets';
import { t, lang, fmtDate } from '../i18n';
import { pending, aiOn, askChanges, type ErrorKind, type AskResult } from './ask';
import { commandPrompt, contextPack, type Scope } from './context';
import { tripPack } from './trip';
import { parseChangeSet, readChangeSet } from './changeset';
import { DiagnosticsButton } from '../app/Diagnostics';
import { openChangeReview } from './Review';
import { dropBase } from '../app/sync';
import { recordArrival } from '../app/home';
import { parseDropFragment } from '../sync/droplink';

/** Shown above any open sheet while a request waits for Send. Mount once, in App. */
export function PreviewHost() {
  const p = pending.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (p) ref.current?.focus({ preventScroll: true }); }, [p]);
  if (!p) return null;
  const r = p.req;
  return (
    <>
      <div class="scrim ai-layer" onClick={() => p.done(false)} />
      <div class="sheet wide ai-layer" role="dialog" aria-modal="true" aria-label={t('aiPreviewTitle')} tabIndex={-1} ref={ref} data-testid="ai-preview"
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); p.done(false); } }}>
        <h3>{t('aiPreviewTitle')}</h3>
        <p class="hint">{t('aiPreviewHint')}</p>
        <dl class="ai-req">
          <dt>{t('aiEndpoint')}</dt><dd>{r.url}</dd>
          <dt>{t('aiModel')}</dt><dd>{r.model}</dd>
          <dt>{t('aiHeaders')}</dt><dd>{Object.entries(r.headers).map(([k, v]) => k + ': ' + v).join('\n')}</dd>
        </dl>
        {p.notes && <p class="hint" data-testid="ai-notes">{t('aiNotesSent')}: {p.notes.length ? p.notes.join(', ') : t('aiNotesNone')}</p>}
        <details class="more"><summary>{t('aiSystem')} ({r.system.length.toLocaleString()})</summary><pre class="ai-pre">{r.system}</pre></details>
        <p class="field-label">{t('aiUser')}</p>
        <pre class="ai-pre" data-testid="ai-user">{r.user}</pre>
        <div class="actions">
          <button class="btn primary" type="button" onClick={() => p.done(true)} data-testid="ai-send">{t('aiSend')}</button>
          <button class="btn ghost" type="button" onClick={() => p.done(false)}>{t('cancel')}</button>
        </div>
      </div>
    </>
  );
}

/** One plain sentence, and a button to the manual path where there is one. */
export function AiError({ error, message, manual, manualLabel }: { error: ErrorKind | 'empty'; message: string; manual?: () => void; manualLabel?: string }) {
  const toSettings = error === 'noKey' || error === 'auth' || error === 'off';
  return (
    <div class="ai-err" data-testid="ai-error" role="alert">
      <p class="err">{message}</p>
      <div class="actions" style="margin-top:6px">
        {manual && <button class="btn small" type="button" onClick={manual}>{manualLabel ?? t('aiManual')}</button>}
        <DiagnosticsButton />
        {toSettings && <button class="btn small ghost" type="button" onClick={() => { closeSheet(); location.hash = '#settings'; }}>{t('aiOpenSettings')}</button>}
      </div>
    </div>
  );
}

/** Command box (feature 1): plain language → change-set → review. Hidden without a provider. */
export function CommandBox({ scope }: { scope: Scope }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: ErrorKind | 'empty'; message: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const go = async (e?: Event) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true); setErr(null);
    ctl.current = new AbortController();
    const { system, user, notes } = commandPrompt(q);
    const r = await askChanges('command', 'quick', system, user, { signal: ctl.current.signal, notes });
    setBusy(false);
    if (!r.ok) { if (r.error !== 'cancelled') setErr(r); return; }
    if (openChangeReview(r.cs, { request: q, onApplied: n => { if (n) setText(''); } })) setErr(null);
  };
  return (
    <div class="aibar">
      {aiOn.value && (
        <form class="cmd" onSubmit={go} data-testid="cmd">
          <label class="field" style="margin:0"><span>{t('cmdLabel')}</span>
            <textarea rows={2} value={text} placeholder={t('cmdPh')} disabled={busy} data-testid="cmd-text"
              onInput={e => setText((e.target as HTMLTextAreaElement).value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go(e); }} />
          </label>
          <div class="go">
            {busy ? <><span class="hint">{t('cmdBusy')}</span><button class="btn small" type="button" onClick={() => ctl.current?.abort()}>{t('stop')}</button></>
              : <><button class="btn primary" type="submit" data-testid="cmd-go">{t('cmdGo')}</button><span class="hint">{t('cmdHint')}</span></>}
          </div>
          {err && <AiError {...err} manual={() => openAskAny(scope, text)} manualLabel={t('askAnyAi')} />}
        </form>
      )}
      <div class="actions ai-links">
        <button class="btn small" type="button" onClick={() => openAskAny(scope)} data-testid="ask-any">{t('askAnyAi')}</button>
        <button class="btn small" type="button" onClick={() => openPaste()} data-testid="paste-reply">{t('pasteReply')}</button>
      </div>
    </div>
  );
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** The pack as it will leave, and the ways to take it: copy, share, then Paste the reply. */
function PackBlock({ pack }: { pack: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => { const ok = await copy(pack); setCopied(ok); toast(ok ? t('packCopied') : t('packCopyBlocked')); };
  const share = async () => { try { await navigator.share({ title: 'Réussite', text: pack }); } catch { /* cancelled */ } };
  return (
    <>
      <details class="more"><summary>{t('packShow', { n: pack.length.toLocaleString() })}</summary><pre class="ai-pre" data-testid="pack">{pack}</pre></details>
      <div class="actions">
        <button class="btn primary" type="button" onClick={doCopy} data-testid="copy-pack">{t('packCopy')}</button>
        {typeof navigator.share === 'function' && <button class="btn" type="button" onClick={share}>{t('packShare')}</button>}
        <button class="btn" type="button" onClick={() => openPaste()} data-testid="pack-paste">{t('pasteReply')}</button>
      </div>
      {copied && <p class="hint" style="margin-top:10px">{t('packNext')}</p>}
    </>
  );
}

function AskAny({ scope: s0, question: q0 }: { scope: Scope; question: string }) {
  const [scope, setScope] = useState<Scope>(s0);
  const [q, setQ] = useState(q0);
  const ps = [...projects.value.values()].filter(p => p.status === 'active' || p.status === 'paused');
  const ds = [...decisions.value.values()].filter(d => d.status !== 'closed');
  const pack = contextPack(scope, q || t('askAnyDefaultQ'), lang.value, dropBase.value);
  const val = scope.kind === 'project' || scope.kind === 'decision' ? scope.kind + ':' + scope.id : scope.kind;
  const pick = (v: string) => { const [k, id] = v.split(':'); setScope(id ? ({ kind: k, id } as Scope) : ({ kind: k } as Scope)); };
  return (
    <div data-testid="ask-any-sheet">
      <h3>{t('askAnyAi')}</h3>
      <p class="hint">{t('askAnyHint')}</p>
      <label class="field"><span>{t('askScope')}</span>
        <select value={val} onChange={e => pick((e.target as HTMLSelectElement).value)} data-testid="ask-scope">
          <option value="today">{t('scopeToday')}</option>
          <option value="matrix">{t('scopeMatrix')}</option>
          {ps.map(p => <option value={'project:' + p.id}>{t('project')}: {p.name}</option>)}
          {ds.map(d => <option value={'decision:' + d.id}>{t('chgDecision')}: {d.title}</option>)}
        </select>
      </label>
      <label class="field"><span>{t('askQuestion')}</span>
        <textarea rows={3} value={q} placeholder={t('askAnyDefaultQ')} onInput={e => setQ((e.target as HTMLTextAreaElement).value)} data-testid="ask-question" />
      </label>
      <PackBlock pack={pack} />
    </div>
  );
}
/** "Ask any AI": a context pack for any chatbot, to the clipboard or the share sheet. Works without a provider. */
export const openAskAny = (scope: Scope = { kind: 'today' }, question = '') => openSheet(<AskAny key={'ask' + Date.now()} scope={scope} question={question} />, true);

/** "Plan this trip": the pack for a stay, with the people there only if ticked for this request (default: not). */
function TripAsk({ stayId }: { stayId: string }) {
  const [q, setQ] = useState('');
  const [withPeople, setWithPeople] = useState(false);
  const pack = tripPack(stayId, q, { people: withPeople, drop: dropBase.value });
  const st = stays.value.get(stayId);
  if (!pack || !st) return <p class="hint">{t('tripGone')}</p>;
  const n = [...people.value.values()].filter(p => p.placeId === st.placeId || p.placeId === 'any').length;
  return (
    <div data-testid="trip-sheet">
      <h3>{t('tripTitle')}</h3>
      <p class="hint">{t('tripHint', { place: placeName(st.placeId), from: fmtDate(st.from), to: fmtDate(st.to) })}</p>
      <label class="field"><span>{t('askQuestion')}</span>
        <textarea rows={3} value={q} placeholder={t('tripQuestionPh')} onInput={e => setQ((e.target as HTMLTextAreaElement).value)} data-testid="trip-question" />
      </label>
      <label class="tog"><input type="checkbox" checked={withPeople} onChange={e => setWithPeople((e.target as HTMLInputElement).checked)} data-testid="trip-people" /> {t('tripPeople', { n })}</label>
      <p class="hint">{t('tripPeopleHint')}</p>
      <p class="hint" data-testid="trip-notes">{t('aiNotesSent')}: {pack.notes.length ? pack.notes.join(', ') : t('aiNotesNone')}</p>
      <PackBlock pack={pack.text} />
    </div>
  );
}
/** "Plan this trip", from a stay: a context pack for an AI with web search. Works without a provider. */
export const openTrip = (stayId: string) => openSheet(<TripAsk key={'trip' + stayId} stayId={stayId} />, true);

const PASTE_ERR = { noJson: 'pasteNoBlock', invalid: 'pasteInvalid', version: 'pasteVersion', empty: 'chgNoneLeft' } as const;
function Paste() {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const go = async (e: Event) => {
    e.preventDefault();
    // A one-tap link pasted instead of a block: read it the same way the drop page does.
    const link = /\/drop#([^\s<>"')\]]+)/.exec(text)?.[1];
    const r = link ? await parseDropFragment(link).then(d => readChangeSet(d.json), () => ({ ok: false as const, error: 'invalid' as const })) : parseChangeSet(text);
    if (!r.ok) { setErr(t(PASTE_ERR[r.error])); return; }
    setErr('');
    // Kept in History with its Undo, like a one-tap link (a trip plan's days and addresses come back this way).
    openChangeReview(r.cs, { record: true, onApplied: (n, undo) => { if (n) void recordArrival(r.cs, 'paste', n, undo); } });
  };
  const fromClipboard = async () => { try { setText(await navigator.clipboard.readText()); } catch { toast(t('pasteBlocked')); } };
  return (
    <form data-testid="paste-sheet" onSubmit={go}>
      <h3>{t('pasteReply')}</h3>
      <p class="hint">{t('pasteHint')}</p>
      <label class="field"><span>{t('pasteLabel')}</span>
        <textarea rows={8} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} data-testid="paste-text" />
      </label>
      {err && <p class="err" role="alert" data-testid="paste-error" style="margin-top:8px">{err}</p>}
      <div class="actions">
        <button class="btn primary" type="submit" disabled={!text.trim()} data-testid="paste-go">{t('pasteGo')}</button>
        {typeof navigator.clipboard?.readText === 'function' && <button class="btn" type="button" onClick={fromClipboard}>{t('pasteFromClipboard')}</button>}
      </div>
    </form>
  );
}
/** "Paste the reply": find the ```reussite block and open the review screen. */
export const openPaste = () => openSheet(<Paste key={'paste' + Date.now()} />, true);

/** One AI call from inside a flow: busy, Stop, and the error to show. */
export function useAi() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: ErrorKind | 'empty'; message: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const run = async <T,>(f: (signal: AbortSignal) => Promise<AskResult<T>>): Promise<T | null> => {
    if (busy) return null;
    setBusy(true); setErr(null);
    ctl.current = new AbortController();
    const r = await f(ctl.current.signal);
    setBusy(false);
    if (!r.ok) { if (r.error !== 'cancelled') setErr(r); return null; }
    return r.data;
  };
  return { busy, err, setErr, run, stop: () => ctl.current?.abort() };
}
export type Ai = ReturnType<typeof useAi>;

/** An AI entry point inside a flow: hidden without a provider; while busy, a Stop button. */
export function AiAction({ ai, label, onClick, testid, manual, manualLabel }: { ai: Ai; label: string; onClick: () => void; testid: string; manual?: () => void; manualLabel?: string }) {
  if (!aiOn.value) return null;
  return (
    <div class="ai-action">
      {ai.busy ? <div class="go"><span class="hint">{t('aiBusy')}</span><button class="btn small" type="button" onClick={ai.stop}>{t('stop')}</button></div>
        : <button class="btn small ai" type="button" onClick={onClick} data-testid={testid}>✦ {label}</button>}
      {ai.err && <AiError {...ai.err} manual={manual ?? (() => ai.setErr(null))} manualLabel={manualLabel ?? t('aiManual')} />}
    </div>
  );
}
