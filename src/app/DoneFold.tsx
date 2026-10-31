// "3 done ▸": the done cards of a list, folded under it (plan 2 Nov, "Lists"). One component for Today, each project and
// any other list of cards, so a ticked card drops out of the way and the open ones stay in view. A native <details>:
// the keyboard (Enter or Space on the summary) and screen readers get it for free, and it starts closed. Nothing when
// there are none. The cards go inside as the caller's own list.
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';

export function DoneFold({ n, children, testid = 'done-fold' }: { n: number; children: ComponentChildren; testid?: string }) {
  if (n <= 0) return null;
  return (
    <details class="donefold" data-testid={testid}>
      <summary data-testid={testid + '-toggle'}>{t('doneFold', { n })}</summary>
      {children}
    </details>
  );
}
