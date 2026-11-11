// First-run setup (S9), two screens: the language (taken from the phone), then the four kinds of time in the person's days, prefilled and editable (name and
// description), and Home. Nothing else is asked: places, AI, sync, the calendar and reminders are "Later" (Settings and the Notifications page), with defaults
// (Anywhere, no AI, sync and reminders off). "Restore with a recovery key" is on the first screen. The AI ways, which used to be the first screen's choices, are the same screens
// opened from Settings (`entry`): a key (a short tutorial, then a conversation that ends in a change-set on the review screen), the person's AI chat app through the connector
// (`ConnectStep`: sync and its recovery key, the connector, the address and pairing code, a check), or any chatbot by copy and paste.
// Every answer waits in a draft and is written once, at the end: a device that pairs with an existing space must not push defaults that would win over the settings
// already there. What the AI path applies is what the person ticked on the review screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import { settings, saveSettings, createDoc, places, toast } from '../app/store';
import { applyTheme } from '../app/theme';
import { go } from '../app/nav';
import { closeSheet } from '../app/sheet';
import { syncOn, connector, relayBase, setupSync, connectorOn, connectorNewCode, refreshConnector, confirmKeySaved } from '../app/sync';
import { Privacy, PairingCode, failure, type Code } from '../app/ConnectorSettings';
import { chatPrompt } from '../app/ChatOffer';
import { Mark } from '../app/Mark';
import { finishedOnboarding } from '../app/onboarding';
import { JoinPanel, KeyView } from '../app/SyncSettings';
import { KeyField } from '../ai/AiSettings';
import { AiError, readReply, PASTE_ERR, useAi } from '../ai/ui';
import { ask, draftProvider } from '../ai/ask';
import { ReviewList, prepareReview } from '../ai/Review';
import { setupPack, setupPrompt, SetupReply, readSetup, onlySetup, type Turn } from '../ai/setup';
import { shortName, type Plan } from '../ai/apply';
import { openCheckin } from './checkin';
import { lang, t, type Key } from '../i18n';
import { SUIT_ORDER, NEW_USER_SUITS, DEFAULT_SETTINGS, type AiProvider, type Settings } from '../data/settings';
import type { Place, SuitId } from '../data/schema';
import type { ChangeSet } from '../ai/changeset';
import { ZONES, deviceZone } from '../domain/zones';
import type { ComponentChildren } from 'preact';

type Id = 'language' | 'pillars' | 'ways' | 'link' | 'key' | 'chat' | 'paste' | 'pair';
/** The three choices of the first screen, and the link under them: `other` is any chatbot, by copy and paste. */
type Path = 'hand' | 'key' | 'connector' | 'other';
/** Where the guided AI set-up opens from Settings: the choice of ways, or one way at once. */
export type Entry = 'ways' | Exclude<Path, 'hand'>;
interface PlaceRow { name: string; timeZone: string }
interface Draft { s: Partial<Settings>; places: PlaceRow[] }
interface AiChoice { want: boolean; provider: Exclude<AiProvider, 'none'>; has: boolean }
type Provider = Exclude<AiProvider, 'none'>;

/** The screens of each path, for "Set-up · n of N". */
const screens = (path: Path): Id[] =>
  path === 'hand' ? ['language', 'pillars']
    : path === 'key' ? ['key', 'chat']
      : path === 'other' ? ['paste']
        : ['link'];

/** What the draft turns into: places first (so the first can be where the person is), then one settings write. */
export async function applyDraft(d: Draft, l: Settings['language'], choice: AiChoice, here?: string): Promise<void> {
  const made: string[] = [];
  const taken = new Set([...places.value.values()].map(p => p.name.toLowerCase()));
  for (const r of d.places) {
    const name = r.name.trim();
    if (!name || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    made.push(await createDoc<Place>('places', { name, timeZone: r.timeZone || deviceZone(), order: places.value.size + made.length }));
  }
  const patch: Partial<Settings> = { ...d.s, language: l };
  if (choice.want && choice.has) patch.aiProvider = choice.provider;
  if (made[0] ?? here) patch.here = (made[0] ?? here)!;
  await saveSettings(patch);
}

function Frame({ id, n, of, title, hint, children, back, next, nextLabel = 'next_', nextDisabled, skip, extra, mark }: {
  id: Id; n?: number; of?: number; title: string; hint?: string; children?: ComponentChildren; back?: () => void; next?: () => void;
  nextLabel?: Key; nextDisabled?: boolean; skip?: () => void; extra?: ComponentChildren; mark?: boolean;
}) {
  return (
    <div class="flow ob" data-testid={'ob-' + id}>
      {mark && <Mark size={72} class="ob-mark" />}
      {n && of && of > 1 ? <p class="eyebrow">{t('obStep', { n, of })}</p> : null}
      <h3>{title}</h3>
      {hint && <p class="hint">{hint}</p>}
      {children}
      <div class="actions ob-actions">
        {back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}
        {next && <button class="btn primary" type="button" onClick={next} disabled={nextDisabled} data-testid="ob-next">{t(nextLabel)}</button>}
      </div>
      {extra}
      {skip && <button class="linklike ob-skip" type="button" onClick={skip} data-testid="ob-skip">{t('obSkip')}</button>}
    </div>
  );
}

const Choice = ({ on, onClick, title, hint, testid, primary }: { on?: boolean; onClick: () => void; title: string; hint?: string; testid: string; primary?: boolean }) => (
  <button type="button" class={'btn' + (primary ? ' primary' : '')} aria-pressed={on} onClick={onClick} data-testid={testid}><b>{title}</b>{hint && <small>{hint}</small>}</button>
);

const KEY_LINKS: Record<Provider, { href: string; label: string; steps: [Key, Key, Key] }> = {
  openai: { href: 'https://openrouter.ai/keys', label: 'openrouter.ai/keys', steps: ['obKeyStepsOpenrouter1', 'obKeyStepsOpenrouter2', 'obKeyStepsOpenrouter3'] },
  anthropic: { href: 'https://console.anthropic.com/settings/keys', label: 'console.anthropic.com', steps: ['obKeyStepsAnthropic1', 'obKeyStepsAnthropic2', 'obKeyStepsAnthropic3'] },
};

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * `entry`: opened from Settings as a guided AI set-up (a sheet), not as first-run: it starts at that way, never writes the first-run record or the starting
 * categories, and `onExit` runs when it ends.
 */
export function Onboarding({ entry, onExit }: { entry?: Entry; onExit?: () => void } = {}) {
  const guided = !!entry;
  const [id, setId] = useState<Id>(entry === 'ways' ? 'ways' : entry === 'key' ? 'key' : entry === 'connector' ? 'link' : entry === 'other' ? 'paste' : 'language');
  const [trail, setTrail] = useState<Id[]>([]);
  const [draft, setDraft] = useState<Draft>({ s: guided ? {} : { suits: NEW_USER_SUITS }, places: [] });
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<Path>(entry && entry !== 'ways' ? entry : 'hand');
  const [provider, setProvider] = useState<Provider>('openai');
  const [hasKey, setHasKey] = useState(false);
  const s = settings.value;
  const merged: Settings = { ...s, ...draft.s, language: lang.value };

  // A French phone starts in French (the person can switch on the first screen).
  useEffect(() => {
    if (!guided && /^fr\b/i.test(navigator.language ?? '') && lang.value !== 'fr') { lang.value = 'fr'; set({ language: 'fr' }); }
  }, []);
  // The language shows as it is chosen (and the default look: St George, light or dark as the system has it); nothing is saved until the end.
  useEffect(() => { if (!guided) applyTheme(merged); });
  // The key tutorial's provider is used by the conversation at once; it is saved with the rest at the end.
  useEffect(() => { draftProvider.value = id === 'key' || id === 'chat' ? provider : null; return () => { draftProvider.value = null; }; }, [id, provider]);

  const set = (p: Partial<Settings>) => setDraft(d => ({ ...d, s: { ...d.s, ...p } }));
  const goTo = (to: Id) => { setTrail([...trail, id]); setId(to); window.scrollTo({ top: 0 }); };
  /** Leaving a guided AI set-up: the sheet closes, back in Settings. */
  const leave = () => { draftProvider.value = null; if (onExit) onExit(); else closeSheet(); };
  const back = trail.length ? () => { setId(trail[trail.length - 1]!); setTrail(trail.slice(0, -1)); } : guided ? leave : undefined;

  const seq = screens(path);
  const pos = { n: Math.max(1, seq.indexOf(id) + 1), of: seq.length };
  const frame = { id, ...pos, back };

  /** The AI path writes the rest of the draft (the language, the key's provider) right after the ticks. */
  const settle = async () => {
    // The AI may have named the pillars already (its ticks are written): the starting categories only fill in when it did not.
    const named = JSON.stringify(settings.value.suits) !== JSON.stringify(DEFAULT_SETTINGS.suits);
    const { suits: _s, ...rest } = draft.s;
    await applyDraft(named ? { ...draft, s: rest } : draft, lang.value, { want: path === 'key', provider, has: hasKey });
  };

  /** Write what was drafted (unless the space on another device is the source of truth), record that set-up is over, and go Home. */
  const finish = async (how: 'done' | 'skipped' | 'paired' = 'done') => {
    setBusy(true);
    if (how !== 'paired') await applyDraft(draft, lang.value, { want: false, provider, has: false });
    await finishedOnboarding(how === 'skipped' ? 'skipped' : 'done');
    draftProvider.value = null;
    go('home');
  };

  const pairedNow = () => void finish('paired');

  /** The review of the AI's change-set was answered: ticked and applied (n > 0), or put aside to go on talking. */
  const reviewed = async (n: number) => {
    if (n <= 0) return;
    await settle();
    toast(t('obAiDone'));
    leave();
  };

  const notTherapy = <p class="hint ob-notherapy" data-testid="ob-not-therapy">{t('notTherapy')}</p>;

  if (id === 'language') return (
    <Frame {...frame} n={undefined} of={undefined} mark title={t('obWelcome')} hint={t('obLanguageHint')} next={() => goTo('pillars')} skip={() => void finish('skipped')}
      extra={<>
        <button class="btn wide ob-pair-link" type="button" onClick={() => goTo('pair')} data-testid="ob-pair-link">{t('obRestore')}</button>
        <p class="hint" data-testid="ob-later">{t('obLater')}</p>
        {notTherapy}
      </>}>
      <div class="bigchoices" role="group" aria-label={t('language')}>
        {([['en', 'English'], ['fr', 'Français']] as const).map(([l, name]) => (
          <button type="button" class="btn" lang={l} aria-pressed={lang.value === l} data-testid={'ob-lang-' + l} onClick={() => { lang.value = l; set({ language: l }); }}><b>{name}</b></button>
        ))}
      </div>
    </Frame>
  );

  if (id === 'pillars') {
    const suits = merged.suits;
    const save = (k: SuitId, field: 'name' | 'desc', v: string) => {
      const cur = suits[k], l = lang.value;
      if (field === 'desc') { set({ suits: { ...suits, [k]: { ...cur, desc: { en: cur.desc?.en ?? '', fr: cur.desc?.fr ?? '', [l]: v.trim() } } } }); return; }
      const name = v.trim() || cur.name[l];
      set({ suits: { ...suits, [k]: { ...cur, name: { ...cur.name, [l]: name }, short: { ...cur.short, [l]: name === cur.name[l] ? cur.short[l] : shortName(name) } } } });
    };
    return (
      <Frame {...frame} title={t('obCatsQ')} hint={t('obCatsHint')} next={() => void finish()} nextLabel="obStart" nextDisabled={busy} skip={() => void finish('skipped')}>
        {SUIT_ORDER.map(k => (
          <div class="field obpillar" key={k + lang.value}>
            <input type="text" defaultValue={suits[k].name[lang.value]} aria-label={t('suitName')} autocomplete="off" data-testid={'ob-pillar-' + k} onChange={e => save(k, 'name', (e.target as HTMLInputElement).value)} />
            <input type="text" defaultValue={suits[k].desc?.[lang.value] ?? ''} aria-label={t('suitDesc')} autocomplete="off" data-testid={'ob-pillar-desc-' + k} onChange={e => save(k, 'desc', (e.target as HTMLInputElement).value)} />
          </div>
        ))}
      </Frame>
    );
  }

  if (id === 'ways') return (
    <Frame {...frame} n={undefined} of={undefined} title={t('obHow')} hint={t('obWaysHint')}>
      <div class="bigchoices">
        <Choice onClick={() => { setPath('key'); goTo('key'); }} title={t('obWayKey')} hint={t('obWayKeyHint')} testid="ob-way-key" />
        <Choice onClick={() => { setPath('connector'); goTo('link'); }} title={t('obWayConnector')} hint={t('obWayConnectorHint')} testid="ob-way-connector" />
      </div>
      <button class="linklike ob-skip" type="button" onClick={() => { setPath('other'); goTo('paste'); }} data-testid="ob-copypaste-link">{t('obCopyPaste')}</button>
    </Frame>
  );

  if (id === 'link') return <ConnectStep {...frame} done={leave} />;

  if (id === 'key') return <KeyStep {...frame} provider={provider} setProvider={setProvider} has={hasKey} setHas={setHasKey} next={() => goTo('chat')} usePaste={() => { setPath('other'); goTo('paste'); }} />;

  if (id === 'chat') return <Chat {...frame} usePaste={() => { setPath('other'); goTo('paste'); }} reviewed={reviewed} />;

  if (id === 'paste') return <PasteStep {...frame} way={path === 'connector' ? 'app' : 'other'} reviewed={reviewed} />;

  return (
    <div class="flow ob" data-testid="ob-pair">
      <JoinPanel onJoined={pairedNow} />
      <div class="actions ob-actions">{back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}</div>
      <p class="hint">{t('obPairSkips')}</p>
    </div>
  );
}

/** A key, step by step, for one of the two kinds of provider; then "Start talking". */
function KeyStep({ provider, setProvider, has, setHas, next, back, usePaste, ...pos }: {
  id: Id; n: number; of: number; back?: () => void; provider: Provider; setProvider: (p: Provider) => void; has: boolean; setHas: (b: boolean) => void; next: () => void; usePaste: () => void;
}) {
  const [test, setTest] = useState<{ busy: boolean; ok: boolean; msg: string } | null>(null);
  const link = KEY_LINKS[provider];
  const run = async () => {
    setTest({ busy: true, ok: false, msg: '' });
    const r = await ask('test', 'quick', 'Reply with exactly this JSON and nothing else: {"ok": true}', 'Connection test.', z.object({ ok: z.literal(true) }), { noPreview: true, maxTokens: 2000 });
    setTest({ busy: false, ok: r.ok, msg: r.ok ? t('obKeyWorks') : r.message });
  };
  return (
    <Frame {...pos} id="key" back={back} title={t('obKeyQ')} hint={t('obKeyIntro')} next={next} nextLabel="obStartTalking" nextDisabled={!has}
      extra={<button class="linklike ob-skip" type="button" onClick={usePaste} data-testid="ob-key-paste">{t('obKeyNoKey')}</button>}>
      <div class="field"><span>{t('aiProvider')}</span>
        <div class="seg" role="group" aria-label={t('aiProvider')}>
          {([['openai', 'obProviderOpenrouter'], ['anthropic', 'aiAnthropic']] as const).map(([v, k]) =>
            <button type="button" style="min-height:44px" aria-pressed={provider === v} data-testid={'ob-ai-' + v} onClick={() => setProvider(v)}>{t(k)}</button>)}
        </div>
        <p class="hint" data-testid="ob-provider-hint">{t('obProviderHint')}</p>
      </div>
      <ol class="obsteps" data-testid="ob-key-steps">
        <li>{t(link.steps[0])} <a href={link.href} target="_blank" rel="noopener noreferrer" data-testid="ob-key-link">{link.label}</a></li>
        <li>{t(link.steps[1])}</li>
        <li>{t(link.steps[2])}</li>
        <li>{t('obKeyStepPaste')}</li>
      </ol>
      <KeyField key={provider} p={provider} onHas={setHas} />
      {has && (
        <div class="actions">
          <button class="btn" type="button" disabled={test?.busy} onClick={run} data-testid="ob-key-test">{test?.busy ? t('aiTesting') : t('aiTest')}</button>
        </div>
      )}
      {test && !test.busy && <p class={test.ok ? 'hint' : 'err'} role="status" data-testid="ob-key-test-result">{test.msg}</p>}
    </Frame>
  );
}

/** The conversation, in the app: the AI asks, the person answers, and it ends on the review screen. */
function Chat({ usePaste, reviewed, back, ...pos }: { id: Id; n: number; of: number; back?: () => void; usePaste: () => void; reviewed: (n: number) => void | Promise<void> }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [say, setSay] = useState('');
  const [review, setReview] = useState<{ plan: Plan; cs: ChangeSet } | null>(null);
  const ai = useAi();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => ai.stop(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns.length, review, ai.busy]);

  const send = async (e?: Event) => {
    e?.preventDefault();
    const m = say.trim();
    if (!m || ai.busy) return;
    const now: Turn[] = [...turns, { who: 'me', text: m }];
    setTurns(now); setSay('');
    const { system, user, notes } = setupPrompt(now);
    const r = await ai.run(signal => ask('setup', 'quick', system, user, SetupReply, { signal, notes }));
    if (!r) return;
    const got = readSetup(r);
    if (got.say) setTurns(x => [...x, { who: 'you', text: got.say }]);
    if (got.cs) {
      const plan = prepareReview(got.cs);
      if (plan) setReview({ plan, cs: got.cs });
    }
  };

  return (
    <div class="flow ob" data-testid="ob-chat">
      {pos.of > 1 && <p class="eyebrow">{t('obStep', { n: pos.n, of: pos.of })}</p>}
      <h3>{t('obChatQ')}</h3>
      <div class="obchat" role="log" aria-live="polite" data-testid="ob-chat-log">
        <p class="bubble you" data-testid="ob-chat-first">{t('obChatFirst')}</p>
        {turns.map(x => <p class={'bubble ' + x.who} data-testid={'ob-chat-' + x.who}>{x.text}</p>)}
        {ai.busy && <p class="bubble you hint" data-testid="ob-chat-busy">{t('obChatThinking')} <button class="btn small" type="button" onClick={ai.stop}>{t('stop')}</button></p>}
        <div ref={end} />
      </div>
      {ai.err && !ai.busy && <AiError {...ai.err} manual={usePaste} manualLabel={t('obChatUsePaste')} />}
      {review ? (
        <ReviewList plan={review.plan} note="" inline onApplied={n => { if (n > 0) void reviewed(n); else setReview(null); }} />
      ) : (
        <form class="morn-say obsay" onSubmit={send}>
          <textarea rows={3} value={say} onInput={e => setSay((e.target as HTMLTextAreaElement).value)} placeholder={t('obChatPh')} aria-label={t('obChatLabel')} disabled={ai.busy} data-testid="ob-chat-say"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(e); }} />
          <button class="btn primary" type="submit" disabled={ai.busy || !say.trim()} data-testid="ob-chat-send">{t('obChatSend')}</button>
        </form>
      )}
      <div class="actions ob-actions">{back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}</div>
    </div>
  );
}

/** The AI chat app of the connector path, or any chatbot: copy a message in, talk there, paste the reply back (Paste the reply, inside the flow). */
function PasteStep({ way, reviewed, back, ...pos }: { id: Id; n: number; of: number; back?: () => void; way: 'app' | 'other'; reviewed: (n: number) => void | Promise<void> }) {
  const pack = setupPack(lang.value);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [review, setReview] = useState<{ plan: Plan; cs: ChangeSet } | null>(null);
  const read = async (e: Event) => {
    e.preventDefault();
    const r = await readReply(text);
    if (!r.ok) { setErr(t(PASTE_ERR[r.error])); return; }
    const cs = onlySetup(r.cs);
    if (!cs) { setErr(t('obPasteNotSetup')); return; }
    setErr('');
    const plan = prepareReview(cs);
    if (plan) setReview({ plan, cs });
  };
  const copy = async () => { const ok = await copyText(pack); setCopied(ok); toast(ok ? t('packCopied') : t('packCopyBlocked')); };
  const share = async () => { try { await navigator.share({ title: 'Réussite', text: pack }); } catch { /* cancelled */ } };
  const fromClipboard = async () => { try { setText(await navigator.clipboard.readText()); } catch { toast(t('pasteBlocked')); } };
  return (
    <div class="flow ob" data-testid="ob-paste">
      {pos.of > 1 && <p class="eyebrow">{t('obStep', { n: pos.n, of: pos.of })}</p>}
      <h3>{way === 'app' ? t('obPasteAppQ') : t('obPasteOtherQ')}</h3>
      <p class="hint">{t('obPasteHint')}</p>
      <ol class="obsteps">
        <li>{t('obPasteStep1')}</li>
        <li>{way === 'app' ? t('obPasteStep2App') : t('obPasteStep2Other')}</li>
        <li>{t('obPasteStep3')}</li>
      </ol>
      <div class="actions">
        <button class="btn primary" type="button" onClick={copy} data-testid="ob-copy-pack">{t('packCopy')}</button>
        {typeof navigator.share === 'function' && <button class="btn" type="button" onClick={share}>{t('packShare')}</button>}
      </div>
      <details class="more"><summary>{t('packShow', { n: pack.length.toLocaleString() })}</summary><pre class="ai-pre" data-testid="ob-pack">{pack}</pre></details>
      {copied && <p class="hint" data-testid="ob-copied">{t('obPasteCopied')}</p>}
      {way === 'app' && <p class="hint" data-testid="ob-connector-note">{t('obConnectorNote')}</p>}
      {review ? (
        <ReviewList plan={review.plan} note={review.cs.note} inline onApplied={n => { if (n > 0) void reviewed(n); else setReview(null); }} />
      ) : (
        <form onSubmit={read}>
          <label class="field"><span>{t('pasteLabel')}</span>
            <textarea rows={6} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} data-testid="ob-paste-text" />
          </label>
          {err && <p class="err" role="alert" data-testid="ob-paste-error">{err}</p>}
          <div class="actions">
            <button class="btn primary" type="submit" disabled={!text.trim()} data-testid="ob-paste-go">{t('obPasteGo')}</button>
            {typeof navigator.clipboard?.readText === 'function' && <button class="btn" type="button" onClick={fromClipboard}>{t('pasteFromClipboard')}</button>}
          </div>
        </form>
      )}
      <div class="actions ob-actions">{back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}</div>
    </div>
  );
}


/**
 * Connect the AI chat app, inside set-up: what the connector needs, step by step, with the Settings pieces. Sync first (its recovery key is shown
 * and kept, as in Settings → Sync), then the connector (privacy said first, as in Settings → Connector), then the address and the
 * pairing code to give the app, and a check that it has come in (the relay says when the connector was last used). Without a relay
 * address, or with a relay that has no connector, it says so and leaves the connector on the Next steps.
 */
function ConnectStep({ back, done, ...pos }: { id: Id; n: number; of: number; back?: () => void; done: () => void }) {
  const [stage, setStage] = useState<'intro' | 'key' | 'add'>(() => (syncOn.value && connector.value?.on ? 'add' : 'intro'));
  const [keyText, setKeyText] = useState('');
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [checked, setChecked] = useState(false);
  const st = connector.value;
  const connected = !!st?.lastUsed;
  const say = chatPrompt('day');

  const connect = async () => {
    setBusy(true); setErr('');
    try { setCode(await connectorOn()); setStage('add'); }
    catch (e) { setErr(failure(e)); setStage('intro'); }
    setBusy(false);
  };
  const on = async () => {
    setErr('');
    if (syncOn.value) { await connect(); return; }
    setBusy(true);
    try { setKeyText(await setupSync()); setStage('key'); }
    catch (e) { setErr(failure(e)); }
    setBusy(false);
  };
  const newCode = async () => {
    setBusy(true); setErr('');
    try { setCode(await connectorNewCode()); } catch (e) { setErr(failure(e)); }
    setBusy(false);
  };
  const check = async () => {
    setBusy(true);
    try { await refreshConnector(); } catch (e) { setErr(failure(e)); }
    setChecked(true); setBusy(false);
  };
  // Already on when this screen opens (a restart in the middle): a fresh code, since the first one is shown once.
  useEffect(() => { if (stage === 'add' && !code) void newCode(); }, []);
  // While the steps are open, ask the relay every few seconds whether the app has come in.
  useEffect(() => {
    if (stage !== 'add' || connected) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') void refreshConnector().catch(() => undefined); }, 4000);
    return () => clearInterval(id);
  }, [stage, connected]);

  if (!relayBase()) return (
    <div class="flow ob" data-testid="ob-link">
      <h3>{t('obLinkQ')}</h3>
      <p data-testid="ob-link-norelay">{t('obLinkNoRelay')}</p>
      <div class="actions ob-actions">
        {back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}
        <button class="btn primary" type="button" onClick={done} data-testid="ob-link-continue">{t('obLinkContinue')}</button>
      </div>
    </div>
  );

  if (stage === 'key') return (
    <div class="flow ob" data-testid="ob-link">
      <h3>{t('obLinkKeyQ')}</h3>
      <p class="hint">{t('obLinkKeyHint')}</p>
      <KeyView text={keyText} />
      {err && <p class="err" role="alert" data-testid="ob-link-error">{err}</p>}
      <div class="actions ob-actions">
        <button class="btn primary" type="button" disabled={busy} onClick={async () => { await confirmKeySaved(); await connect(); }} data-testid="ob-link-key-saved">{t('syncKeySavedBtn')}</button>
      </div>
    </div>
  );

  if (stage === 'intro') return (
    <div class="flow ob" data-testid="ob-link">
      {pos.of > 1 && <p class="eyebrow">{t('obStep', { n: pos.n, of: pos.of })}</p>}
      <h3>{t('obLinkQ')}</h3>
      <p>{t('obLinkIntro')}</p>
      <Privacy />
      {err && <p class="err" role="alert" data-testid="ob-link-error">{err}</p>}
      <div class="actions ob-actions">
        {back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}
        <button class="btn primary" type="button" disabled={busy} onClick={() => void on()} data-testid="ob-link-on">{syncOn.value ? t('obLinkOnOnly') : t('obLinkOn')}</button>
        <button class="btn" type="button" disabled={busy} onClick={done} data-testid="ob-link-later">{t('obLinkLater')}</button>
      </div>
      <p class="hint">{t('obLinkLaterHint')}</p>
    </div>
  );

  const copyUrl = () => navigator.clipboard?.writeText(st?.url ?? '').then(() => toast(t('connectorUrlCopied')), () => undefined);
  return (
    <div class="flow ob" data-testid="ob-link">
      <h3>{t('obLinkAddQ')}</h3>
      <p class="hint">{t('obLinkAddHint')}</p>
      <ol class="obsteps" data-testid="ob-link-steps">
        <li>{t('obLinkS1')}</li>
        <li>{t('obLinkS2')}
          <ul class="obapps" data-testid="ob-link-apps">
            <li>{t('obLinkAppClaude')}</li>
            <li>{t('obLinkAppOther')}</li>
          </ul>
        </li>
        <li>{t('obLinkS3')}</li>
      </ol>
      <div class="field"><span>{t('connectorUrlLabel')}</span>
        <p class="urlbox mono" data-testid="ob-link-url">{st?.url ?? ''}</p>
        <div class="actions"><button class="btn" type="button" onClick={copyUrl} data-testid="ob-link-copy-url">{t('connectorCopyUrl')}</button></div>
      </div>
      <PairingCode code={code} onNew={newCode} busy={busy} />
      {err && <p class="err" role="alert" data-testid="ob-link-error">{err}</p>}
      <p role="status" class="hint" data-testid="ob-link-state">
        {connected ? t('obLinkWorks', { say }) : checked ? t('obLinkNotYet') : t('obLinkWaiting')}
      </p>
      <div class="actions">
        <button class="btn" type="button" disabled={busy} onClick={() => void check()} data-testid="ob-link-check">{t('obLinkCheck')}</button>
      </div>
      <p class="hint">{t('obLinkTry', { say })}</p>
      <div class="actions ob-actions">
        <button class="btn primary" type="button" onClick={done} data-testid="ob-link-continue">{t('obLinkContinue')}</button>
      </div>
      {!connected && <p class="hint">{t('obLinkLaterHint')}</p>}
    </div>
  );
}
