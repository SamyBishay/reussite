// AI on screen: "Show me what's sent", the command box (named for the AI the person set up), and Plan this trip.
import { useEffect, useRef, useState } from 'preact/hooks';
import { openSheet, closeSheet } from '../app/ui';
import { settings, stays, people, places, toast } from '../app/store';
import { onPage } from '../domain/places';
import { placeName } from '../app/sheets';
import { t, fmtDate } from '../i18n';
import { pending, aiOn, askChanges, type ErrorKind, type AskResult } from './ask';
import { commandPrompt, type Scope } from './context';
import { aiName } from './aiName';
import { tripPrompt } from './trip';
import { DiagnosticsButton } from '../app/Diagnostics';
import { openChangeReview } from './Review';
import { recordTrip } from '../app/home';
import { offersChat } from '../app/ChatOffer';

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
      <div class="actions" style="margin-top:var(--s2)">
        {manual && <button class="btn small" type="button" onClick={manual}>{manualLabel ?? t('aiManual')}</button>}
        <DiagnosticsButton />
        {toSettings && <button class="btn small ghost" type="button" onClick={() => { closeSheet(); location.hash = '#settings'; }}>{t('aiOpenSettings')}</button>}
      </div>
    </div>
  );
}

/**
 * Command box (feature 1): plain language → change-set → review. Only with an AI set up and its key on this device, and then it
 * names that AI ("Ask Claude to change the list"). Without one there is nothing here: no button. `scope` is kept for the callers; the box no longer uses it.
 * `compact` (Matrix, Projects): one line, the label out of sight and the button beside the text, so the boxes below stay on the screen.
 */
export function CommandBox({ compact }: { scope?: Scope; compact?: boolean }) {
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
  if (!aiOn.value) return null;
  const provider = settings.value.aiProvider;
  const ai = provider === 'none' ? t('aiYours') : aiName(provider, settings.value.aiModels[provider].quick);
  return (
    <div class="aibar">
      <form class={'cmd' + (compact ? ' compact' : '')} onSubmit={go} data-testid="cmd">
        <label class="field" style="margin:0"><span data-testid="cmd-label">{t('cmdLabel', { ai })}</span>
          <textarea rows={compact ? 1 : 2} value={text} placeholder={t(compact ? 'cmdPhShort' : 'cmdPh', { ai })} disabled={busy} data-testid="cmd-text"
            onInput={e => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go(e); }} />
        </label>
        <div class="go">
          {busy ? <><span class="hint">{t('cmdBusy')}</span><button class="btn small" type="button" onClick={() => ctl.current?.abort()}>{t('stop')}</button></>
            : <><button class="btn primary" type="submit" data-testid="cmd-go" title={compact ? t('cmdHint') : undefined}>{t('cmdGo')}</button><span class="hint">{t('cmdHint')}</span></>}
        </div>
        {err && <AiError {...err} />}
      </form>
    </div>
  );
}

/**
 * "Plan this trip", from a stay. With a key on this device it asks the AI directly (the people there only if ticked, for this request; default: not),
 * and the change-set opens on the review screen, kept in History with its Undo. With the connector and no key it gives the sentence to say in the
 * chat app, which reads the list itself. With neither, Settings does not offer the button.
 */
function TripAsk({ stayId }: { stayId: string }) {
  const [q, setQ] = useState('');
  const [withPeople, setWithPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: ErrorKind | 'empty'; message: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const st = stays.value.get(stayId);
  const prompt = aiOn.value ? tripPrompt(stayId, q, { people: withPeople }) : null;
  if (!st || !places.value.get(st.placeId)) return <p class="hint">{t('tripGone')}</p>;
  const where = { place: placeName(st.placeId), from: fmtDate(st.from), to: fmtDate(st.to) };

  if (!aiOn.value) {
    if (!offersChat()) return <p class="hint">{t('tripNoAi')}</p>;
    const say = t('chatTripPrompt', where);
    const copy = () => navigator.clipboard?.writeText(say).then(() => toast(t('chatCopied', { say })), () => toast(t('chatCopied', { say })));
    return (
      <div data-testid="trip-sheet">
        <h3>{t('tripTitle')}</h3>
        <p class="hint">{t('tripChatHint', where)}</p>
        <p class="ai-say" data-testid="trip-say">“{say}”</p>
        <div class="actions"><button class="btn primary" type="button" onClick={copy} data-testid="trip-copy-say">{t('tripChatCopy')}</button></div>
      </div>
    );
  }

  const n = [...people.value.values()].filter(p => onPage(places.value, p.placeId, st.placeId)).length;
  const go = async () => {
    const pr = tripPrompt(stayId, q, { people: withPeople });
    if (!pr || busy) return;
    setBusy(true); setErr(null);
    ctl.current = new AbortController();
    const r = await askChanges('trip', 'thinking', pr.system, pr.user, { signal: ctl.current.signal, notes: pr.notes });
    setBusy(false);
    if (!r.ok) { if (r.error !== 'cancelled') setErr(r); return; }
    const text = q.trim() || t('tripRequest', { place: where.place });
    openChangeReview(r.cs, { request: text, record: true, onApplied: (applied, undo) => { if (applied) void recordTrip(r.cs, applied, undo, text); } });
  };
  return (
    <div data-testid="trip-sheet">
      <h3>{t('tripTitle')}</h3>
      <p class="hint">{t('tripHint', where)}</p>
      <label class="field"><span>{t('askQuestion')}</span>
        <textarea rows={3} value={q} placeholder={t('tripQuestionPh')} onInput={e => setQ((e.target as HTMLTextAreaElement).value)} data-testid="trip-question" />
      </label>
      <label class="tog"><input type="checkbox" checked={withPeople} onChange={e => setWithPeople((e.target as HTMLInputElement).checked)} data-testid="trip-people" /> {t('tripPeople', { n })}</label>
      <p class="hint">{t('tripPeopleHint')}</p>
      <p class="hint" data-testid="trip-notes">{t('aiNotesSent')}: {prompt?.notes.length ? prompt.notes.join(', ') : t('aiNotesNone')}</p>
      <div class="actions">
        {busy ? <><span class="hint">{t('aiBusy')}</span><button class="btn small" type="button" onClick={() => ctl.current?.abort()}>{t('stop')}</button></>
          : <button class="btn primary" type="button" onClick={() => void go()} data-testid="trip-go">{t('tripGo')}</button>}
      </div>
      {err && <AiError {...err} />}
    </div>
  );
}
/** "Plan this trip", from a stay (Settings → Method → More → Stays). */
export const openTrip = (stayId: string) => openSheet(<TripAsk key={'trip' + stayId} stayId={stayId} />, true);

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
