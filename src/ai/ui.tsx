// AI on screen: "Show me what's sent", the command box (named for the AI the person set up), the trip pack's copy and share, and the pasted reply.
import { useEffect, useRef, useState } from 'preact/hooks';
import { openSheet, closeSheet } from '../app/ui';
import { settings, stays, people, places, toast } from '../app/store';
import { onPage } from '../domain/places';
import { placeName } from '../app/sheets';
import { t, fmtDate } from '../i18n';
import { pending, aiOn, askChanges, type ErrorKind, type AskResult } from './ask';
import { commandPrompt, type Scope } from './context';
import { aiName } from './aiName';
import { tripPack } from './trip';
import { parseChangeSet, readChangeSet, type ParseResult } from './changeset';
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
 * names that AI ("Ask Claude to change the list"). Without one there is nothing here: no button, no copy-and-paste route on the
 * screen (that route lives in set-up and in Plan this trip). `scope` is kept for the callers; the box no longer uses it.
 */
export function CommandBox(_: { scope?: Scope }) {
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
      <form class="cmd" onSubmit={go} data-testid="cmd">
        <label class="field" style="margin:0"><span data-testid="cmd-label">{t('cmdLabel', { ai })}</span>
          <textarea rows={2} value={text} placeholder={t('cmdPh', { ai })} disabled={busy} data-testid="cmd-text"
            onInput={e => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go(e); }} />
        </label>
        <div class="go">
          {busy ? <><span class="hint">{t('cmdBusy')}</span><button class="btn small" type="button" onClick={() => ctl.current?.abort()}>{t('stop')}</button></>
            : <><button class="btn primary" type="submit" data-testid="cmd-go">{t('cmdGo')}</button><span class="hint">{t('cmdHint')}</span></>}
        </div>
        {err && <AiError {...err} />}
      </form>
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
      {copied && <p class="hint" style="margin-top:var(--s3)">{t('packNext')}</p>}
    </>
  );
}

/** "Plan this trip": the pack for a stay, with the people there only if ticked for this request (default: not). */
function TripAsk({ stayId }: { stayId: string }) {
  const [q, setQ] = useState('');
  const [withPeople, setWithPeople] = useState(false);
  const pack = tripPack(stayId, q, { people: withPeople, drop: dropBase.value });
  const st = stays.value.get(stayId);
  if (!pack || !st) return <p class="hint">{t('tripGone')}</p>;
  const n = [...people.value.values()].filter(p => onPage(places.value, p.placeId, st.placeId)).length;
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

export const PASTE_ERR = { noJson: 'pasteNoBlock', invalid: 'pasteInvalid', version: 'pasteVersion', empty: 'chgNoneLeft' } as const;
/** A pasted reply read: the one-tap link pasted instead of a block is read the same way the drop page does. */
export async function readReply(text: string): Promise<ParseResult> {
  const link = /\/drop#([^\s<>"')\]]+)/.exec(text)?.[1];
  return link ? parseDropFragment(link).then(d => readChangeSet(d.json), () => ({ ok: false as const, error: 'invalid' as const })) : parseChangeSet(text);
}
function Paste() {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const go = async (e: Event) => {
    e.preventDefault();
    const r = await readReply(text);
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
      {err && <p class="err" role="alert" data-testid="paste-error" style="margin-top:var(--s2)">{err}</p>}
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
