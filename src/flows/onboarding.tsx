// First-run setup (S9), short and friendly: language, then three explicit choices, each saying what it gives day to day: AI inside the
// app (a key), the person's AI chat app through the connector, or no AI. No AI is the four pillars of the person's days as plain questions, then their
// places, then done. A key is a short tutorial, then a conversation that ends in a change-set (the pillars, the places, how they want
// an AI to work with them) on the review screen. The connector sets the pillars and places first (by one copy and paste in a chat
// with that app, or by hand: the connector cannot write settings), then connects the app right there (`ConnectStep`: sync and its recovery key,
// the connector, the address and pairing code, a check). Another chatbot is a link under the choices: the same copy and paste. No look screen (St George and
// the system's light or dark; the look stays in Settings), and no cards or suits in the words. Sync, notifications, Addresses &
// people and the recovery key are Home's Next steps card (src/app/NextSteps.tsx).
// Every answer by hand waits in a draft and is written once, at the end: a device that pairs with an existing space must not push
// defaults that would win over the settings already there. What the AI path applies is what the person ticked on the review screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import { settings, saveSettings, createDoc, places, toast } from '../app/store';
import { applyTheme } from '../app/theme';
import { go } from '../app/nav';
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
import { SUIT_ORDER, type AiProvider, type Settings } from '../data/settings';
import type { Place, SuitId } from '../data/schema';
import type { ChangeSet } from '../ai/changeset';
import { ZONES, deviceZone } from '../domain/zones';
import type { ComponentChildren } from 'preact';

type Id = 'language' | 'pillars' | 'places' | 'basics' | 'link' | 'key' | 'chat' | 'paste' | 'pair' | 'done';
/** The three choices of the first screen, and the link under them: `other` is any chatbot, by copy and paste. */
type Path = 'hand' | 'key' | 'connector' | 'other';
interface PlaceRow { name: string; timeZone: string }
interface Draft { s: Partial<Settings>; places: PlaceRow[] }
interface AiChoice { want: boolean; provider: Exclude<AiProvider, 'none'>; has: boolean }
type Provider = Exclude<AiProvider, 'none'>;

/** The screens of each path, for "Set-up · n of N". The connector sets the pillars and places first (by a chat with the person's AI chat app, or by hand), then connects. */
const screens = (path: Path, basics: 'chat' | 'hand'): Id[] =>
  path === 'hand' ? ['pillars', 'places']
    : path === 'key' ? ['key', 'chat']
      : path === 'other' ? ['paste']
        : basics === 'chat' ? ['basics', 'paste', 'link'] : ['basics', 'pillars', 'places', 'link'];

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

/** The four questions of the by-myself way: what each pillar is about, and examples of a name for it. */
const PILLAR_Q: Record<SuitId, [Key, Key]> = {
  S: ['obPillarQ_S', 'obPillarEx_S'],
  D: ['obPillarQ_D', 'obPillarEx_D'],
  C: ['obPillarQ_C', 'obPillarEx_C'],
  H: ['obPillarQ_H', 'obPillarEx_H'],
};

const KEY_LINKS: Record<Provider, { href: string; label: string; steps: [Key, Key, Key] }> = {
  openai: { href: 'https://openrouter.ai/keys', label: 'openrouter.ai/keys', steps: ['obKeyStepsOpenrouter1', 'obKeyStepsOpenrouter2', 'obKeyStepsOpenrouter3'] },
  anthropic: { href: 'https://console.anthropic.com/settings/keys', label: 'console.anthropic.com', steps: ['obKeyStepsAnthropic1', 'obKeyStepsAnthropic2', 'obKeyStepsAnthropic3'] },
};

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function Onboarding() {
  const [id, setId] = useState<Id>('language');
  const [trail, setTrail] = useState<Id[]>([]);
  const [draft, setDraft] = useState<Draft>({ s: {}, places: [{ name: '', timeZone: deviceZone() }] });
  const [skipped, setSkipped] = useState(false);
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<Path>('hand');
  const [basics, setBasics] = useState<'chat' | 'hand'>('chat');
  const [provider, setProvider] = useState<Provider>('openai');
  const [hasKey, setHasKey] = useState(false);
  /** The AI's change-set was ticked and applied: the places and settings are written already. */
  const [applied, setApplied] = useState(false);
  const s = settings.value;
  const merged: Settings = { ...s, ...draft.s, language: lang.value };

  // A French phone starts in French (the person can switch on the first screen).
  useEffect(() => {
    if (/^fr\b/i.test(navigator.language ?? '') && lang.value !== 'fr') { lang.value = 'fr'; set({ language: 'fr' }); }
  }, []);
  // The language shows as it is chosen (and the default look: St George, light or dark as the system has it); nothing is saved until the end.
  useEffect(() => { applyTheme(merged); });
  // The key tutorial's provider is used by the conversation at once; it is saved with the rest at the end.
  useEffect(() => { draftProvider.value = id === 'key' || id === 'chat' ? provider : null; return () => { draftProvider.value = null; }; }, [id, provider]);

  const set = (p: Partial<Settings>) => setDraft(d => ({ ...d, s: { ...d.s, ...p } }));
  const goTo = (to: Id) => { setTrail([...trail, id]); setId(to); window.scrollTo({ top: 0 }); };
  const back = trail.length ? () => { setId(trail[trail.length - 1]!); setTrail(trail.slice(0, -1)); } : undefined;
  const skip = () => { setSkipped(true); goTo('done'); };

  const seq = screens(path, basics);
  const pos = { n: Math.max(1, seq.indexOf(id) + 1), of: seq.length };
  const frame = { id, ...pos, back };

  /** The AI path writes the rest of the draft (the language, the key's provider, where the person is) right after the ticks. */
  const settle = async () => {
    const first = [...places.value.values()].sort((a, b) => a.order - b.order)[0]?.id;
    await applyDraft(draft, lang.value, { want: path === 'key', provider, has: hasKey }, first);
  };

  /** Write what was drafted (unless the space on another device is the source of truth, or the AI's ticks already settled it), then leave. */
  const finish = async (then: 'home' | 'checkin') => {
    setBusy(true);
    if (!paired && !applied) await applyDraft(draft, lang.value, { want: path === 'key', provider, has: hasKey });
    // The connector stays on the Next steps for someone who chose it and did not connect it here (it goes by itself once it is on).
    await finishedOnboarding(skipped ? 'skipped' : 'done', { connector: path === 'connector' });
    draftProvider.value = null;
    go('home');
    if (then === 'checkin') openCheckin();
  };

  const pairedNow = () => {
    // The space has the settings and places; what was drafted here is dropped.
    setPaired(true);
    setDraft({ s: {}, places: [] });
    setTrail([]);
    setId('done');
  };

  /** The review of the AI's change-set was answered: ticked and applied (n > 0), or put aside to go on talking. */
  const reviewed = async (n: number) => {
    if (n <= 0) return;
    await settle();
    setApplied(true); setTrail([...trail, id]); setId(path === 'connector' ? 'link' : 'done'); window.scrollTo({ top: 0 });
  };

  /** By hand, before connecting: the answers are written now (sync, once on, would make a restart look like an existing install and lose a draft). */
  const toLink = async () => {
    setBusy(true);
    await applyDraft(draft, lang.value, { want: false, provider, has: false });
    setApplied(true); setBusy(false);
    goTo('link');
  };

  const notTherapy = <p class="hint ob-notherapy" data-testid="ob-not-therapy">{t('notTherapy')}</p>;

  if (id === 'language') return (
    <Frame {...frame} n={undefined} of={undefined} mark title={t('obWelcome')} hint={t('obLanguageHint')} skip={skip}
      extra={<>
        <button class="btn wide ob-pair-link" type="button" onClick={() => goTo('pair')} data-testid="ob-pair-link">{t('obHaveDevice')}</button>
        {notTherapy}
      </>}>
      <div class="bigchoices" role="group" aria-label={t('language')}>
        {([['en', 'English'], ['fr', 'Français']] as const).map(([l, name]) => (
          <button type="button" class="btn" lang={l} aria-pressed={lang.value === l} data-testid={'ob-lang-' + l} onClick={() => { lang.value = l; set({ language: l }); }}><b>{name}</b></button>
        ))}
      </div>
      <p class="field-label ob-how">{t('obHow')}</p>
      <div class="bigchoices">
        <Choice onClick={() => { setPath('key'); goTo('key'); }} title={t('obWayKey')} hint={t('obWayKeyHint')} testid="ob-way-key" />
        <Choice onClick={() => { setPath('connector'); goTo('basics'); }} title={t('obWayConnector')} hint={t('obWayConnectorHint')} testid="ob-way-connector" />
        <Choice onClick={() => { setPath('hand'); goTo('pillars'); }} title={t('obWayNone')} hint={t('obWayNoneHint')} testid="ob-way-none" />
      </div>
      <button class="linklike ob-skip" type="button" onClick={() => { setPath('other'); goTo('paste'); }} data-testid="ob-copypaste-link">{t('obCopyPaste')}</button>
    </Frame>
  );

  if (id === 'pillars') {
    const suits = merged.suits;
    const save = (k: SuitId, v: string) => {
      const cur = suits[k], name = v.trim() || cur.name[lang.value];
      set({ suits: { ...suits, [k]: { ...cur, name: { ...cur.name, [lang.value]: name }, short: { ...cur.short, [lang.value]: shortName(name) } } } });
    };
    return (
      <Frame {...frame} title={t('obPillarsQ')} hint={t('obPillarsHint')} next={() => goTo('places')} nextLabel="obKeepThese" skip={skip}>
        {SUIT_ORDER.map(k => (
          <label class="field obpillar" key={k + lang.value}><span>{t(PILLAR_Q[k][0])}</span>
            <input type="text" defaultValue={suits[k].name[lang.value]} aria-label={t(PILLAR_Q[k][0])} autocomplete="off" data-testid={'ob-pillar-' + k} onChange={e => save(k, (e.target as HTMLInputElement).value)} />
            <small class="hint">{t(PILLAR_Q[k][1])}</small>
          </label>
        ))}
      </Frame>
    );
  }

  if (id === 'places') {
    const rows = draft.places;
    const setRows = (r: PlaceRow[]) => setDraft(d => ({ ...d, places: r }));
    const edit = (i: number, p: Partial<PlaceRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
    const zones = (z: string) => (ZONES.includes(z) ? ZONES : [z, ...ZONES]);
    return (
      <Frame {...frame} title={t('obPlacesQ')} hint={t('obPlacesHint')} next={() => (path === 'connector' ? void toLink() : goTo('done'))} nextLabel={path === 'connector' ? 'next_' : 'obFinish'} nextDisabled={busy || !rows.some(r => r.name.trim())} skip={skip}>
        {rows.map((r, i) => (
          <div class="obplace" data-testid="ob-place">
            <input type="text" value={r.name} placeholder={t('obPlacePh')} aria-label={t('placeName')} autocomplete="off" data-testid="ob-place-name" onInput={e => edit(i, { name: (e.target as HTMLInputElement).value })} />
            {rows.length > 1 && <button class="btn ghost" type="button" aria-label={t('remove', { what: r.name.trim() || t('placeName') })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>}
            <select aria-label={t('timeZone')} value={r.timeZone} onChange={e => edit(i, { timeZone: (e.target as HTMLSelectElement).value })}>
              {zones(r.timeZone).map(z => <option value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        ))}
        <div class="actions"><button class="btn" type="button" onClick={() => setRows([...rows, { name: '', timeZone: rows[rows.length - 1]?.timeZone ?? deviceZone() }])} data-testid="ob-place-add">{t('addPlaceBtn')}</button></div>
      </Frame>
    );
  }

  if (id === 'basics') return (
    <Frame {...frame} title={t('obBasicsQ')} hint={t('obBasicsHint')} skip={skip}>
      <div class="bigchoices">
        <Choice onClick={() => { setBasics('chat'); goTo('paste'); }} title={t('obBasicsChat')} hint={t('obBasicsChatHint')} testid="ob-basics-chat" />
        <Choice onClick={() => { setBasics('hand'); goTo('pillars'); }} title={t('obBasicsHand')} hint={t('obBasicsHandHint')} testid="ob-basics-hand" />
      </div>
    </Frame>
  );

  if (id === 'link') return <ConnectStep {...frame} back={basics === 'hand' ? back : undefined} done={() => goTo('done')} />;

  if (id === 'key') return <KeyStep {...frame} provider={provider} setProvider={setProvider} has={hasKey} setHas={setHasKey} next={() => goTo('chat')} usePaste={() => { setPath('other'); goTo('paste'); }} />;

  if (id === 'chat') return <Chat {...frame} usePaste={() => { setPath('other'); goTo('paste'); }} reviewed={reviewed} />;

  if (id === 'paste') return <PasteStep {...frame} way={path === 'connector' ? 'app' : 'other'} reviewed={reviewed} />;

  if (id === 'pair') return (
    <div class="flow ob" data-testid="ob-pair">
      <JoinPanel onJoined={pairedNow} />
      <div class="actions ob-actions">{back && <button class="btn ghost" type="button" onClick={back} data-testid="ob-back">{t('back')}</button>}</div>
      <p class="hint">{t('obPairSkips')}</p>
    </div>
  );

  return (
    <div class="flow ob" data-testid="ob-done">
      <h3>{skipped ? t('obDoneSkipped') : t('obDone')}</h3>
      <p data-testid="ob-done-text">{paired ? t('obDonePaired') : path === 'connector' && connector.value?.on ? t('obDoneConnected', { say: chatPrompt('day') }) : applied ? t('obDoneAi') : t('obDoneHint')}</p>
      {!paired && <p class="hint" data-testid="ob-done-next">{t('obDoneNext')}</p>}
      <div class="bigchoices">
        <button type="button" class="btn primary" disabled={busy} onClick={() => void finish('checkin')} data-testid="ob-plan"><b>{t('obPlanFirst')}</b><small>{t('obPlanFirstHint')}</small></button>
        <button type="button" class="btn" disabled={busy} onClick={() => void finish('home')} data-testid="ob-home"><b>{t('obGoHome')}</b></button>
      </div>
      <div class="actions ob-actions">{back && !applied && <button class="btn ghost" type="button" onClick={back} disabled={busy} data-testid="ob-back">{t('back')}</button>}</div>
      {notTherapy}
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
        <button class="btn" type="button" disabled={busy} onClick={() => void connect()} data-testid="ob-link-key-later">{t('syncKeyLater')}</button>
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
