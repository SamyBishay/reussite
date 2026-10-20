// The bottom sheet (one at a time) and the full-screen overlay used by the close-of-day show.
import { signal } from '@preact/signals';
import type { VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n';

export const sheet = signal<VNode | null>(null);
/** A sheet meant for a guided flow: wider on large screens. */
export const sheetWide = signal(false);
let lastFocus: Element | null = null;
export function openSheet(v: VNode, wide = false) {
  if (!sheet.value) lastFocus = document.activeElement;
  sheetWide.value = wide;
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
    // The dialog takes focus when it opens, unless a field inside already has it (the effect runs after the first paint, and a field filled in that gap must keep its focus).
    if (open && ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sheet.value) closeSheet(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div class="scrim" onClick={closeSheet} />
      <div class={'sheet' + (sheetWide.value ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={t('details')} tabIndex={-1} ref={ref} data-testid="sheet">
        <button class="sheet-x" type="button" onClick={closeSheet} aria-label={t('close')}>×</button>
        {sheet.value}
      </div>
    </>
  );
}

/** Full-screen layer (the close-of-day show). */
export const overlay = signal<VNode | null>(null);
export function OverlayHost() {
  return overlay.value;
}
