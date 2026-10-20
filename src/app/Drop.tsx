// The one-tap link's two ends in the app (docs/CHANGESET.md, "The one-tap link").
// DropHost is the drop page: the app served at /drop, with the link in the fragment. Where this
// browser holds the same space, the review opens at once; elsewhere (an iPhone's Safari) the
// change-set is sealed to the inbox key and left on the relay. InboxHost opens the review for each
// change-set the relay is holding for this person, one at a time, and deletes it from the relay
// when the person has applied or dismissed it. Nothing is applied without ticks.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { ready, readOnly } from './store';
import { go as goTo } from './nav';
import { recordArrival } from './home';
import { sheet, openSheet, overlay } from './sheet';
import { finishDrop, inboxQueue, relayBase, spaceId, syncLoaded } from './sync';
import { logError } from './errorlog';
import { postToInbox, RelayError } from '../sync/client';
import { DropLinkError, parseDropFragment } from '../sync/droplink';
import { InboxError, sealToInbox } from '../sync/inbox';
import { readChangeSet, type ChangeSet } from '../ai/changeset';
import { openChangeReview, prepareReview, ReviewList } from '../ai/Review';
import { t, type Key } from '../i18n';

/** The fragment of the link this page was opened with, while it has not been dealt with. Read once, at load. */
export const dropFragment = signal<string | null>(/\/drop\/?$/.test(location.pathname) ? location.hash : null);

/** Back to the app's own address: the link has been handled and must not run again on reload. */
function leaveDropPage() {
  try { history.replaceState(null, '', new URL('./', document.baseURI).pathname); } catch { /* fine */ }
  dropFragment.value = null;
}

type State = { kind: 'wait' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; key: Key; code?: string };

const RELAY_ERR: Partial<Record<string, Key>> = { unknown_space: 'dropUnknown', network: 'dropNetwork', rate_limited: 'dropBusy', too_large: 'dropTooBig' };

/** Check a link and send it to the inbox. Resolves with what to show; throws nothing. */
export async function sendDrop(space: string, pub: string, cs: ChangeSet): Promise<State> {
  const base = relayBase();
  if (!base) return { kind: 'error', key: 'dropNoRelay' };
  try {
    // Sent as checked: re-reading it on the other side gives the same change-set.
    await postToInbox(base, space, await sealToInbox(space, pub, { v: 1, note: cs.note, changes: cs.changes }));
    return { kind: 'sent' };
  } catch (e) {
    if (e instanceof InboxError || (e instanceof DOMException && e.name === 'NotSupportedError')) return { kind: 'error', key: 'dropUnsupported' };
    if (e instanceof RelayError) return RELAY_ERR[e.code] ? { kind: 'error', key: RELAY_ERR[e.code]! } : { kind: 'error', key: 'dropFailed', code: e.code };
    void logError(e, 'drop');
    return { kind: 'error', key: 'dropFailed', code: 'error' };
  }
}

export function DropHost() {
  const frag = dropFragment.value;
  const [state, setState] = useState<State>({ kind: 'wait' });
  const ran = useRef(false);
  const go = ready.value && syncLoaded.value;
  useEffect(() => {
    if (frag === null || !go || ran.current) return;
    ran.current = true;
    void (async () => {
      let link;
      try { link = await parseDropFragment(frag); } catch (e) { setState({ kind: 'error', key: e instanceof DropLinkError ? 'dropBad' : 'dropFailed', code: 'link' }); return; }
      const r = readChangeSet(link.json);
      if (!r.ok) { setState({ kind: 'error', key: r.error === 'empty' ? 'dropEmpty' : 'dropBad' }); return; }
      if (spaceId() === link.space) { // this browser holds the list: the review opens on Home, and what is applied is kept in History with Undo
        leaveDropPage();
        goTo('home');
        openChangeReview(r.cs, { record: true, onApplied: (n, undo) => { if (n) void recordArrival(r.cs, 'link', n, undo); } });
        return;
      }
      setState({ kind: 'sending' });
      setState(await sendDrop(link.space, link.pub, r.cs));
    })();
  }, [frag, go]);
  // Another link in the same tab (only the fragment changes, so the page isn't loaded again).
  useEffect(() => {
    const onHash = () => {
      if (!/\/drop\/?$/.test(location.pathname) || location.hash === dropFragment.value) return;
      ran.current = false;
      setState({ kind: 'wait' });
      dropFragment.value = location.hash;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // The installed app asked to focus its open window for a link (manifest `launch_handler`): the link comes here, not as a page load.
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: { setConsumer(f: (p: { targetURL?: string }) => void): void } }).launchQueue;
    queue?.setConsumer(p => {
      let u: URL;
      try { u = new URL(p.targetURL ?? ''); } catch { return; }
      if (u.origin !== location.origin || !/\/drop\/?$/.test(u.pathname) || !u.hash) return;
      try { history.replaceState(null, '', u.pathname + u.hash); } catch { return; }
      ran.current = false;
      setState({ kind: 'wait' });
      dropFragment.value = u.hash;
    });
  }, []);
  if (frag === null) return null;
  return (
    <div class="drop" role="status" aria-live="polite" data-testid="drop-page">
      {state.kind !== 'wait' && (
        <div>
          <h1>{t('appName')}</h1>
          {state.kind === 'sending' && <p data-testid="drop-sending">{t('dropSending')}</p>}
          {state.kind === 'sent' && <p data-testid="drop-sent">{t('dropSent')}</p>}
          {state.kind === 'error' && <p class="err" role="alert" data-testid="drop-error">{t(state.key, { code: state.code ?? '' })}</p>}
          {(state.kind === 'sent' || state.kind === 'error') && <div class="actions"><button class="btn primary" type="button" onClick={leaveDropPage} data-testid="drop-open-app">{t('dropOpenApp')}</button></div>}
        </div>
      )}
    </div>
  );
}

/** Opens the review for each change-set waiting in the inbox, once nothing else is open. */
export function InboxHost() {
  const queue = inboxQueue.value;
  const open = sheet.value;
  const showing = useRef<{ id: string; node: VNode } | null>(null);
  const idle = !open && !overlay.value && !readOnly.value && dropFragment.value === null;
  useEffect(() => {
    const cur = showing.current;
    if (cur) {
      if (open !== cur.node) { showing.current = null; void finishDrop(cur.id); } // applied, cancelled or closed
      return;
    }
    const next = queue[0];
    if (!next || !idle) return;
    const plan = prepareReview(next.cs); // says so itself when nothing would change
    if (!plan) { void finishDrop(next.id); return; }
    const node = <ReviewList key={'inbox' + next.id} plan={plan} note={next.cs.note} record onApplied={(n, undo) => { if (n) void recordArrival(next.cs, 'inbox', n, undo); }} />;
    showing.current = { id: next.id, node };
    openSheet(node, true);
  }, [queue, open, idle]);
  return null;
}
