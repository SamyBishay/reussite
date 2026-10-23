// Ordering by dragging: SortableJS on a list whose items carry `data-task`, started from a `.grip` handle so that
// scrolling and tapping stay as they were. It works with a finger and a mouse (its own pointer fallback, not the
// browser's drag and drop, which phones do not do). The DOM is put back and the new order is handed to
// `onReorder`, which writes through an action; Preact then draws the list from the data.
import Sortable from 'sortablejs';
import { useEffect, useRef } from 'preact/hooks';

export function useSortable<E extends HTMLElement>(onReorder: (ids: string[]) => void) {
  const ref = useRef<E>(null);
  const cb = useRef(onReorder);
  cb.current = onReorder;
  const inst = useRef<{ el: HTMLElement; s: Sortable } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (inst.current && inst.current.el !== el) { inst.current.s.destroy(); inst.current = null; }
    if (!el || inst.current) return;
    let next: Element | null = null;
    const s = Sortable.create(el, {
      handle: '.grip', draggable: '[data-sort]', animation: 120, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 3, ghostClass: 'drag-ghost', chosenClass: 'drag-chosen',
      onStart: e => { next = e.item.nextElementSibling; },
      onEnd: e => {
        const ids = [...e.from.querySelectorAll<HTMLElement>(':scope > [data-sort]:not(.sortable-fallback)')].map(x => x.dataset.task!);
        // Put the node back where Preact left it, so its next render finds the DOM it expects.
        e.from.insertBefore(e.item, next);
        if (e.oldIndex !== e.newIndex) cb.current(ids);
      },
    });
    inst.current = { el, s };
  });
  useEffect(() => () => { inst.current?.s.destroy(); inst.current = null; }, []);
  return ref;
}

/** The handle: decorative, since ↑ and ↓ are the keyboard and screen-reader way. */
export const GRIP = '⠿';
