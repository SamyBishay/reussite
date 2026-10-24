// Shared view pieces, ported from v1's render helpers.
import type { ComponentChildren } from 'preact';
import { settings, projects, today, toast } from './store';
import { quad, blocked, waitingOn, spentOf, personal, estModel, addressById, personById, addressesOn, type T } from './model';
import { openDue } from './due';
import { OPTS } from '../domain/estimates';
import { startTask } from './actions';
import { t, lang, fmtDate, fmtMin, frTypo, type Key } from '../i18n';
import { daysBetween } from '../domain/dates';
import { shiftTime } from '../domain/calendar';
import { resolveLink, detectPlatform } from '../domain/links';
import type { SuitId } from '../data/schema';

export { sheet, openSheet, closeSheet, SheetHost } from './sheet';

// ---------- text ----------
/** The step's verb ("Open Mail") in bold, as in v1. */
export function Title({ s }: { s: string }) {
  let m = /^(Open\s+(?:a\s+new\s+\S+\s+chat|\S+(?:\s+\S+)?))(?=\s+and\b|[,:]|$)([\s\S]*)$/i.exec(s) ||
    /^(Ouvrir\s+\S+(?:\s+\S+)?)(?=\s+et\b|[,:]|$)([\s\S]*)$/i.exec(s);
  if (!m) m = /^(\S+)([\s\S]*)$/.exec(s);
  return m ? <><span class="verb">{m[1]}</span>{m[2]}</> : <>{s}</>;
}

export const suitName = (s: SuitId, short = false) => {
  const v = settings.value.suits[s];
  const name = v ? (short ? v.short : v.name)[lang.value] : s;
  return lang.value === 'fr' ? frTypo(name) : name;
};

export function Suit({ s }: { s: SuitId }) {
  const g = settings.value.suits[s]?.glyph ?? s;
  return <span class={'g suit-' + s} aria-label={suitName(s, true)}>{g}</span>;
}

export function Due({ k }: { k: string }) {
  const n = daysBetween(today.value, k);
  const txt = n === 0 ? t('dueToday') : n === 1 ? t('dueTomorrow') : n < 0 ? t('dueLate', { n: Math.abs(n) }) : t('dueOn', { date: fmtDate(k) });
  return <span class={'due' + (n <= settings.value.urgencyDays ? ' soon' : '')}>{txt}</span>;
}

/** A step's due date, editable where it appears (brief §5): today, tomorrow, +1 week, clear. */
export function DueChip({ tk, empty = false }: { tk: T; empty?: boolean }) {
  if (tk.status !== 'open') return null;
  if (!tk.due && !empty) return null;
  return (
    <button type="button" class="duechip" onClick={e => { e.stopPropagation(); openDue(tk.id); }} aria-label={t('changeDue')}>
      {tk.due ? <Due k={tk.due} /> : <span class="due muted">{t('addDue')}</span>}
    </button>
  );
}

/** The basis of a personal estimate, in one line. */
export function basisLine(tk: T): string {
  const p = personal(tk);
  if (!p) return learningLine();
  const f = p.factor.toFixed(1).replace('.', lang.value === 'fr' ? ',' : '.');
  const b = p.basis;
  const what = b.kind === 'app' ? t('basisApp', { app: tk.app || b.key }) : b.kind === 'project' ? t('basisProject', { name: projects.value.get(b.key)?.name ?? t('inbox') })
    : b.kind === 'suit' ? t('basisSuit', { suit: suitName(b.key as SuitId, true) }) : t('basisAll');
  return t('basisLine', { what, n: b.n, f });
}
export const learningLine = () => t('learningPace', { n: Math.min(OPTS.minWeight - 1, Math.floor(estModel.value.weight)), of: OPTS.minWeight });

/** The person's estimate first; the personal estimate only after it (brief §5: no anchoring). */
export function Est({ tk }: { tk: T }) {
  if (!tk.est) return <span class="est muted">{t('noEstimate')}</span>;
  const guess = tk.estBy === 'ai';
  const p = tk.status === 'open' ? personal(tk) : null;
  return (
    <span class={'est' + (guess ? ' guess' : '')} title={guess ? t('aiGuess') : t('yourEstimate')}>
      {(guess ? '~' : '') + fmtMin(tk.est)}
      {p && p.value !== tk.est && <button type="button" class="pest" onClick={e => { e.stopPropagation(); toast(basisLine(tk)); }} aria-label={basisLine(tk)}>{' → ' + t('usually', { t: fmtMin(p.value) })}</button>}
    </span>
  );
}

const QKEY: Record<number, Key> = { 1: 'qNow', 2: 'qProtect', 3: 'qQuick', 4: 'qLater' };
export const quadName = (n: number) => t(QKEY[n]!);

function Dot() { return <span aria-hidden="true">·</span>; }
export function joinDots(parts: ComponentChildren[]) {
  const out: ComponentChildren[] = [];
  parts.filter(Boolean).forEach((p, i) => { if (i) out.push(<Dot key={'d' + i} />); out.push(p); });
  return out;
}

export function Meta({ tk, withQuad }: { tk: T; withQuad?: boolean }) {
  const p = projects.value.get(tk.project);
  const spent = spentOf(tk.id);
  const w = waitingOn(tk)[0];
  const parts: ComponentChildren[] = [
    <span key="s"><Suit s={tk.suit} /> {p ? p.name : t('inbox')}</span>,
    withQuad && <span key="q" class="tag">{quadName(quad(tk))}</span>,
    tk.kind === 'decision' && <span key="k" class="tag">{t('decisionTag')}</span>,
    <Est key="e" tk={tk} />,
    spent > 0 && <span key="sp">{t('timedSoFar', { t: fmtMin(spent) })}</span>,
    tk.at && <span key="at" class="due">{tk.at}{tk.dur ? '–' + shiftTime(tk.at, tk.dur) : ''}</span>,
    tk.due ? (tk.status === 'open' ? <DueChip key="due" tk={tk} /> : <Due key="due" k={tk.due} />) : tk.urgent && tk.status === 'open' && <span key="u" class="tag urg">{t('urgent')}</span>,
    tk.repeat && <span key="r" class="tag" title={t('repeats')}>↻</span>,
    blocked(tk) && w && <span key="w" class="tag">{t('waitsFor', { what: w.title.length > 40 ? w.title.slice(0, 38) + '…' : w.title })}</span>,
    (tk.carried || 0) >= 3 && <span key="c" class="tag warn">{t('carriedTag', { n: tk.carried })}</span>,
    feeds(tk),
  ];
  return <>{joinDots(parts)}</>;
}

/** The address or person a step feeds, said quietly (nothing when the module is off or the link points at nothing). */
function feeds(tk: T): ComponentChildren {
  if (!addressesOn()) return null;
  const a = addressById(tk.addressId), p = personById(tk.personId);
  if (a) return <span key="fa" class="feeds" data-testid="feeds">{t('feedsAddress', { name: a.name })}</span>;
  if (p) return <span key="fp" class="feeds" data-testid="feeds">{t('feedsPerson', { name: p.name })}</span>;
  return null;
}

// ---------- opening apps and websites ----------
const platform = typeof window !== 'undefined' ? detectPlatform() : { ios: false, standalone: false, mobile: false };

/**
 * A link to the step's app or website. Opens from the tap itself (nothing awaited first,
 * or iOS ignores it); copies the prompt for Claude steps and starts the timer.
 */
export function GoLink({ tk, variant }: { tk: T; variant: 'big' | 'small' | 'inline' }) {
  const target = resolveLink(tk, platform, settings.value.linksInApp);
  if (!target || tk.status !== 'open') return null;
  const label = tk.prompt ? t('openClaude') : t('openApp', { app: tk.app || t('openIt') });
  const isWeb = target.href.startsWith('https:');
  const onClick = () => {
    if (tk.prompt) {
      try {
        navigator.clipboard.writeText(tk.prompt).then(() => toast(t('promptCopied')), () => toast(t('copyBlocked')));
      } catch { /* the link still opens */ }
    }
    if (!tk.started) void startTask(tk.id);
  };
  const cls = variant === 'inline' ? 'lnk' : 'btn' + (variant === 'big' ? ' primary' : ' small');
  return (
    <a class={cls} href={target.href} onClick={onClick} data-testid="go"
      {...(isWeb && !settings.value.linksInApp ? { target: '_blank', rel: 'noopener' } : {})}>
      {variant === 'inline' ? (tk.prompt ? 'Claude ↗' : tk.app ? tk.app + ' ↗' : '↗') : label}
    </a>
  );
}

/** A link out of the app (Maps, WhatsApp, Mail…) under the same rules as a step's link: an app by its own scheme, a website in the browser. */
export function ExtLink({ href, class: cls, children, testid }: { href: string; class?: string; children: ComponentChildren; testid?: string }) {
  const target = resolveLink({ link: href }, platform, settings.value.linksInApp);
  if (!target) return null;
  const web = target.href.startsWith('https:');
  return (
    <a class={cls} href={target.href} data-testid={testid} {...(web && !settings.value.linksInApp ? { target: '_blank', rel: 'noopener' } : {})}>{children}</a>
  );
}
