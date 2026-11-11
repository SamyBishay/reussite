// Notifications: everything that is waiting, one row each with its buttons. Home shows only a quiet button with a neutral dot while something here
// has not been seen (no number, no red). Opening this page marks what is listed as seen; the entries stay, with their actions, until they are dealt with.
// What used to sit on Home lives here: Plan the day / Close the day, the missed fixed-time step, Next steps, and the app's banners.
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Rings } from '../app/Rings';
import { today, settings, readOnly, viewingElsewhere } from '../app/store';
import { dayDoc, decisionsToCheck, carriedOn, greetingNow, missedOn } from '../app/model';
import { openCarried, MissedCard } from '../app/CarryUi';
import { KeyCard } from '../app/SyncSettings';
import { syncOn, keySaved } from '../app/sync';
import { startReview } from '../flows/reviewai';
import { openCheckin } from '../flows/checkin';
import { openPlanDay } from '../flows/morning';
import { openClose } from '../flows/close';
import { ChatOffer } from '../app/ChatOffer';
import { NextStepsCard, nextLinesNow } from '../app/NextSteps';
import { StillBanner, stillRunning, ReadOnlyBanner, SyncStaleBanner, syncIsStale, ViewingBanner } from '../app/Banners';
import { UpdateBanner, updateReady } from '../app/UpdateBanner';
import { aiOn } from '../ai/ask';
import { openDecisionPage } from '../flows/decision';
import { isoDow } from '../domain/repeat';
import { t } from '../i18n';
import type { ComponentChild } from 'preact';

export interface Entry { key: string; node: ComponentChild }

/** What is waiting, most pressing first. The key names the entry for "seen": the same thing waiting stays seen, a new one lights the dot. */
export function entries(): Entry[] {
  const k = today.value, out: Entry[] = [];
  const add = (key: string, node: ComponentChild) => out.push({ key, node });
  if (readOnly.value) add('readonly', <ReadOnlyBanner />);
  if (syncIsStale()) add('stale', <SyncStaleBanner />);
  if (updateReady.value) add('update', <UpdateBanner />);
  const still = stillRunning();
  if (still) add('still:' + still.id, <StillBanner />);
  if (syncOn.value && !keySaved.value) add('key', <KeyCard />);
  for (const dc of decisionsToCheck(k)) add('decision:' + dc.id, <div class="banner" data-testid="decision-check"><p>{t('checkDecision', { title: dc.title })}</p><button class="btn small" type="button" onClick={() => openDecisionPage(dc.id, true)}>{t('checkNow')}</button></div>);
  if (carriedOn(k).length) add('carry:' + k, <div class="banner" data-testid="carry-nudge"><p>{t('carryText')}</p><button class="btn small" type="button" onClick={openCarried}>{t('carryButton')}</button></div>);
  const missed = missedOn(k)[0];
  if (missed) add('missed:' + missed, <MissedCard key={missed} id={missed} onNext={() => {}} />);
  if (isoDow(k) === settings.value.reviewDay && !dayDoc(k)?.review) add('review:' + k, <div class="banner" data-testid="review-card"><p>{t('reviewToday')}</p><button class="btn small" type="button" onClick={startReview}>{t('startReview')}</button><ChatOffer what="review" small testid="review-chat" /></div>);
  const g = greetingNow.value;
  if (g?.kind === 'plan') {
    add('plan:' + k, (
      <section class="first" data-testid="greeting-plan">
        <p class="eyebrow">{t('noListYet')}</p>
        <p class="t">{t('planTheDayQ')}</p>
        <div class="go">
          <button class="btn primary" type="button" onClick={openPlanDay} data-testid="home-plan">{t('planTheDay')}</button>
          {aiOn.value && <button class="btn ghost" type="button" onClick={openCheckin} data-testid="home-plan-ritual">{t('mornMyself')}</button>}
          <ChatOffer what="day" testid="home-plan-chat" />
        </div>
      </section>
    ));
  } else if (g) {
    add('close:' + k, (
      <section class="first" data-testid="greeting-done">
        <p class="eyebrow">{t('listPlayed')}</p>
        <p class="t">{t('allDone')}</p>
        <p class="hint">{t('addOneOrClose')}</p>
        <div class="go"><button class="btn" type="button" onClick={openClose}>{t('closeTheDay')}</button></div>
      </section>
    ));
  }
  if (viewingElsewhere.value) add('viewing', <ViewingBanner />);
  const next = nextLinesNow();
  if (next.length) add('next:' + next.join(','), <NextStepsCard />);
  return out;
}

// ---------- seen
const SEEN = 'reussite.notifseen';
const readSeen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(SEEN) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const seen = signal<string[]>(readSeen());
const markSeen = (keys: string[]) => {
  seen.value = keys;
  try { localStorage.setItem(SEEN, JSON.stringify(keys)); } catch { /* the dot just comes back */ }
};

/** Something listed that has not been seen on this device: Home's button shows a neutral dot. */
export const unread = (): boolean => entries().some(e => !seen.value.includes(e.key));

export function Notifications() {
  const list = entries();
  const keys = list.map(e => e.key).join('|');
  useEffect(() => { markSeen(entries().map(e => e.key)); }, [keys]);
  return (
    <div data-testid="notifications">
      <h2 class="sec" style="margin-top:0">{t('notifTitle')}</h2>
      {list.length ? list.map(e => <div key={e.key} class="notif">{e.node}</div>) : <div class="emptystate"><Rings /><p class="hint" data-testid="notifications-empty">{t('notifEmpty')}</p></div>}
    </div>
  );
}
