// The height of the top edge (`#topbar`) as the custom property `--topbar-h`, for the one thing that has to sit below it by number: the suit piles' sticky offset.
// Everything else starts below the top edge by layout, because the top edge is in the flow.

/** Keeps `--topbar-h` on <html> equal to the element's height. Returns a function that stops it. */
export function watchTopbar(el: HTMLElement): () => void {
  const set = () => document.documentElement.style.setProperty('--topbar-h', el.getBoundingClientRect().height + 'px');
  set();
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const ro = new ResizeObserver(set);
  ro.observe(el);
  return () => ro.disconnect();
}
