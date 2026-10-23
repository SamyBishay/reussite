// The two folds the app uses to keep forms and Settings calm. `More` holds a form's optional fields, folded, after the
// essentials; its summary says "More" and, when something inside has a value, how many ("More · 2 set"), so nothing
// that is set is hidden without a hint. `Fold` is one Settings section, a heading that opens. Both are native
// <details>: the keyboard and screen readers get them for free, and the open state lives in the DOM, so a re-render
// of the form never closes what the person opened.
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';

/** How many of these values are set (anything but empty, false, null, 0 or an empty list). */
export const countSet = (...vs: unknown[]): number => vs.filter(v => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : !!v)).length;

export function More({ n = 0, children, testid = 'more', open }: { n?: number; children: ComponentChildren; testid?: string; open?: boolean }) {
  return (
    <details class="more" data-testid={testid} open={open}>
      <summary>{t('moreLabel')}{n > 0 && <span class="more-n" data-testid={testid + '-count'}> · {t('moreSet', { n })}</span>}</summary>
      {children}
    </details>
  );
}

/** A Settings section: its heading is the summary. Only the first is open to begin with. */
export function Fold({ title, testid, open, children }: { title: string; testid?: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="set fold" data-testid={testid} open={open}>
      <summary><h2>{title}</h2></summary>
      <div class="foldbody">{children}</div>
    </details>
  );
}

/** Opens a Settings section from code (a link that points into it). */
export function openFold(el: Element | null | undefined): void {
  const d = el?.closest('details.fold') ?? (el instanceof HTMLDetailsElement ? el : null);
  if (d) (d as HTMLDetailsElement).open = true;
}
