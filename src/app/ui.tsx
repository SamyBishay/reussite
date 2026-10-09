// Shared view pieces, ported from v1's render helpers.
import { signal } from '@preact/signals';
import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { settings, projects, today, toast } from './store';
import { quad, blocked, waitingOn, spentOf, type T } from './model';
import { startTask } from './actions';
import { t, lang, fmtDate, fmtMin, frTypo, type Key } from '../i18n';
import { daysBetween } from '../domain/dates';
import { resolveLink, detectPlatform } from '../domain/links';
import type { SuitId } from '../data/schema';

// ---------- sheets ----------
export const sheet = signal<VNode | null>(null);
let lastFocus: Element | null = null;
export function openSheet(v: VNode) {
  if (!sheet.value) lastFocus = document.activeElement;
  sheet.value = v;
}
export function closeSheet() {
  sheet.value = null;
  if (lastFocus instanceof HTMLElement && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

export function SheetHost() {
  const ref = useRef<HTMLDivElement>(null);
  const open = !!sheet.value;
  useEffect(() => {
    if (open) ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sheet.value) closeSheet(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div class="scrim" onClick={closeSheet} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={t('details')} tabIndex={-1} ref={ref} data-testid="sheet">
        <button class="sheet-x" type="button" onClick={closeSheet} aria-label={t('close')}>×</button>
        {sheet.value}
      </div>
    </>
  );
}

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

export function Est({ tk }: { tk: T }) {
  if (!tk.est) return <span class="est muted">{t('noEstimate')}</span>;
  const guess = tk.estBy === 'ai';
  return <span class={'est' + (guess ? ' guess' : '')} title={guess ? t('aiGuess') : t('yourEstimate')}>{(guess ? '~' : '') + fmtMin(tk.est)}</span>;
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
    tk.due ? <Due key="due" k={tk.due} /> : tk.urgent && tk.status === 'open' && <span key="u" class="tag urg">{t('urgent')}</span>,
    blocked(tk) && w && <span key="w" class="tag">{t('waitsFor', { what: w.title.length > 40 ? w.title.slice(0, 38) + '…' : w.title })}</span>,
    (tk.carried || 0) >= 3 && <span key="c" class="tag warn">{t('carriedTag', { n: tk.carried })}</span>,
  ];
  return <>{joinDots(parts)}</>;
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
