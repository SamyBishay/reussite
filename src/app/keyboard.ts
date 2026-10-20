// Is the on-screen keyboard open? Phones only (no hover): a focused text field is the signal, because
// the layout viewport does not shrink when the keyboard opens (iOS never does; Chrome on Android doesn't
// by default). While it is open `body.kb` hides the tab bar, and `--kb` is how far the keyboard covers
// the bottom of the layout viewport (from visualViewport), so anything fixed there can rise above it.
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'date', 'time', 'datetime-local', 'month', 'week']);
const isText = (el: Element | null): boolean =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NOT_TEXT.has(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

export function startKeyboard() {
  if (!matchMedia('(hover: none), (pointer: coarse)').matches) return;
  const vv = window.visualViewport;
  let focus = false, seen = false, pressing = false;
  const covered = () => (vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0);
  const update = () => {
    const c = vv && vv.scale <= 1.01 ? covered() : 0;
    // Once the keyboard has been seen, closing it by gesture (focus stays) brings the bar back.
    if (c > 120) seen = true;
    // A finger that is down keeps things as they are: the bar coming back under it would swallow the tap
    // on the button that took the focus away.
    const open = pressing ? document.body.classList.contains('kb') : focus && !(seen && c <= 120);
    document.body.classList.toggle('kb', open);
    document.documentElement.style.setProperty('--kb', (open ? c : 0) + 'px');
  };
  document.addEventListener('focusin', e => { focus = isText(e.target as Element); seen = false; update(); });
  // Moving from one field to the next fires focusout first; look again once focus has landed.
  document.addEventListener('focusout', () => setTimeout(() => { focus = isText(document.activeElement); if (!focus) seen = false; update(); }, 50));
  addEventListener('pointerdown', () => { pressing = true; }, true);
  const lift = () => { pressing = false; setTimeout(update, 150); };
  addEventListener('pointerup', lift, true);
  addEventListener('pointercancel', lift, true);
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
}
