// Home (brief §5): where the person types, and nothing else. A slim top bar (wordmark, clock, date, the bell with its neutral dot, the menu), the mark with a greeting,
// centred in the room above the input, one line after a change ("Created: …", "Changed: …") and the input. What waits (Plan the day, the missed step, Next steps, banners)
// is behind the bell (Notifications); what Home would ask (a pick, how long, an answer) is shown on Today. The menu icon holds what has no tab:
// Settings, Places, Addresses & people (and + Address, one tap from here), Memory and History.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { today } from '../app/store';
import { T, dayDoc, lineInputNow } from '../app/model';
import { openTask } from '../app/sheets';
import { shownGreetings, rememberGreeting } from '../app/greetingShown';
import { openSheet, closeSheet } from '../app/ui';
import { openPlaces } from '../app/PlacesSheet';
import { openNewAddress } from '../app/AddressSheets';
import { addressesOn } from '../app/model';
import { go, type View } from '../app/nav';
import { isTouch } from '../app/keyboard';
import { cardNow, homeLine, submitHome } from '../app/home';
import { HomeHelp } from '../app/HomeHelp';
import { aiOn } from '../ai/ask';
import { unread } from './Notifications';
import { nextSteps } from '../app/onboarding';
import { refreshPushState } from '../app/push';
import { Mark } from '../app/Mark';
import { DoveClock } from '../app/DoveClock';
import { eligibleLines, greetingLine, seedOf, type GreetingKey } from '../domain/greeting';
import { t, fmtDate } from '../i18n';

function HomeMenu() {
  const to = (v: View) => { closeSheet(); go(v); };
  return (
    <div data-testid="home-menu-sheet">
      <h3>{t('menu')}</h3>
      <ul class="picklist menu">
        <li><button type="button" class="linklike" onClick={() => to('settings')} data-testid="menu-settings"><b>{t('tabSettings')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => { closeSheet(); openPlaces(); }} data-testid="menu-places"><b>{t('placesTitle')}</b></button></li>
        {addressesOn() && <li><button type="button" class="linklike" onClick={() => to('addresses')} data-testid="menu-addresses"><b>{t('addrTitle')}</b></button></li>}
        {addressesOn() && <li><button type="button" class="linklike" onClick={() => { closeSheet(); openNewAddress(); }} data-testid="menu-add-address"><b>{t('addrNewBtn')}</b></button></li>}
        <li><button type="button" class="linklike" onClick={() => to('memory')} data-testid="menu-memory"><b>{t('memoryTitle')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => to('waiting')} data-testid="menu-waiting"><b>{t('waitingTitle')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => to('history')} data-testid="menu-history"><b>{t('historyTitle')}</b></button></li>
      </ul>
    </div>
  );
}

// ---------- the greeting ----------
/**
 * The line above the card: one sentence from the templates, filled with what is true today (src/domain/greeting.ts). It is chosen
 * when Home opens and kept while it stays open (unless what it says stops being true), and is not the same as one said earlier today
 * while another fits. It is the same with an AI on: the AI's work lives in the conversation, not in this wording.
 */
function GreetingLine() {
  const day = today.value;
  const chosen = useRef<GreetingKey | null>(null);
  const input = lineInputNow();
  let line = chosen.current ? eligibleLines(input).find(l => l.key === chosen.current) : undefined;
  if (!line) {
    line = greetingLine(input, shownGreetings(day), seedOf(day)) ?? undefined;
    chosen.current = line?.key ?? null;
    if (line) rememberGreeting(day, line.key);
  }
  if (!line) return null;
  // Short lines are set big, long ones smaller so they stay a few lines and never overflow (the list of hellos holds a word and whole sentences).
  const text = t(line.key, line.slots), size = text.length > 60 ? ' xlong' : text.length > 28 ? ' long' : '';
  return <p class={'greetline' + size} data-testid="greeting-hello" data-key={line.key}>{text}</p>;
}

// ---------- the line ----------
/** After a change was applied: "Created: <title>" or "Changed: <title>", in the row just above the input. A tap opens the card; it goes at the next input. */
function Line() {
  const l = homeLine.value;
  const el = useRef<HTMLParagraphElement>(null);
  // The row is fixed just above the input; its height is published (as --rcpt) for the page's bottom padding and so that the toast lifts above it.
  useLayoutEffect(() => {
    const p = el.current;
    const root = document.documentElement.style;
    if (!p) { root.removeProperty('--rcpt'); return; }
    const set = () => root.setProperty('--rcpt', p.offsetHeight + 'px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(p);
    return () => { ro.disconnect(); root.removeProperty('--rcpt'); };
  }, [!!l]);
  if (!l) return null;
  const text = l.title
    ? t(l.kind === 'created' ? 'homeLineCreated' : 'homeLineChanged', { title: l.title })
    : t('homeLineChangedN', { n: l.n });
  const open = () => { if (l.id && T(l.id)) openTask(l.id); else go('history'); };
  return (
    <p class="receipt" ref={el} data-testid="home-line" role="status">
      <button type="button" class="linklike homeline" onClick={open} data-testid="home-line-open">{text}</button>
    </p>
  );
}

// ---------- the input ----------
/** Fixed above the tab bar; dictation works in it. Enter sends, Shift+Enter starts a new line; on a phone sending closes the keyboard. */
function HomeInput() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const bar = useRef<HTMLFormElement>(null);
  // The bar's height is published for the page's bottom padding and the toast, which sit above it. Before the first paint, so that Home never shows a frame without its room.
  useLayoutEffect(() => {
    const el = bar.current!, root = document.documentElement.style;
    const set = () => root.setProperty('--inputh', el.offsetHeight + 'px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty('--inputh'); };
  }, []);
  // Home never asks: a pick, a duration or an answer shows on Today.
  const mounted = useRef(false);
  useEffect(() => { if (mounted.current && cardNow.value && !(cardNow.value.kind === 'answer' && cardNow.value.asking)) go('today'); mounted.current = true; }, [cardNow.value]);
  useEffect(() => {
    const el = ta.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
  }, [text]);
  const send = async (e?: Event) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    // On a phone the keyboard closes on send: the receipt and the tab bar come back, and a sheet that opens
    // does not give the focus (and the keyboard) back to the input when it closes.
    if (isTouch()) ta.current?.blur();
    setBusy(true);
    const taken = await submitHome(text);
    setBusy(false);
    if (taken) setText('');
  };
  return (
    <form class="homein" ref={bar} onSubmit={send} data-testid="home-input-bar">
      <div class="homein-in">
        {!aiOn.value && <button type="button" class="icon-btn" onClick={() => openSheet(<HomeHelp fill={s => { setText(s); ta.current?.focus(); }} />)} aria-label={t('homeHelpBtn')} data-testid="home-help">?</button>}
        <textarea ref={ta} rows={1} value={text} placeholder={t('homeInputPh')} aria-label={t('homeInputLabel')} enterkeyhint="send" autocomplete="off" autocapitalize="sentences"
          onInput={e => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) void send(e); }} data-testid="home-input" />
        <button class="btn primary send" type="submit" disabled={busy || !text.trim()} aria-label={t('homeSend')} data-testid="home-send">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>
    </form>
  );
}

export function Home() {
  const d = dayDoc(today.value);
  // The dot counts Next steps' reminder line, which needs to know what the browser supports.
  useEffect(() => { if (nextSteps.value.on) refreshPushState(); }, [nextSteps.value.on]);
  return (
    <div class="home" data-testid="home">
      <div class="homebar">
        <div class="homehead">
          <div class="wordrow"><h1 class="word">{t('appName')}</h1><DoveClock /></div>
          <p class="dateline">{fmtDate(today.value, { weekday: 'long', day: 'numeric', month: 'long' })}{d?.closed ? ' · ' + t('dayClosed') : ''}</p>
        </div>
        <div class="homebtns">
          <button type="button" class="icon-btn bell" onClick={() => go('notifications')} aria-label={t('notifTitle')} data-testid="home-bell">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0" /></svg>
            {unread() && <i class="dot" data-testid="bell-dot" aria-hidden="true" />}
          </button>
          <button type="button" class="icon-btn" onClick={() => openSheet(<HomeMenu />)} aria-label={t('menu')} data-testid="home-menu">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      <div class="homestage">
        <section class="greeting" data-testid="greeting">
          <div class="hello"><Mark size="var(--markh)" /><GreetingLine /></div>
        </section>
      </div>
      <Line />
      <HomeInput />
    </div>
  );
}
