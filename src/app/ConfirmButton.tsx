// The one two-tap button: the first tap arms it (its label changes), the second does it. The label not shown is laid in the same cell as an invisible
// `::after` (`data-other`), so the button is as wide as the longer of the two: arming it never moves the buttons beside it and the confirm label never wraps
// (`tests/e2e/twostate.spec.ts`, 320 and 390 px, English and French). Drop, Remove and Delete are all this component.
import { useState } from 'preact/hooks';
import { toast } from './store';
import { dropTask, droppedLine } from './actions';
import type { T as Tk } from './model';
import { t } from '../i18n';

export function ConfirmButton({ label, confirmLabel, onConfirm, testid, cls = 'btn ghost small', disabled }: {
  label: string; confirmLabel: string; onConfirm: () => void | Promise<unknown>; testid?: string; cls?: string; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button class={cls + ' twostate'} type="button" data-testid={testid} disabled={disabled} data-armed={armed ? '1' : undefined} data-other={armed ? label : confirmLabel}
      onClick={() => { if (!armed) return setArmed(true); void onConfirm(); }}>
      <span>{armed ? confirmLabel : label}</span>
    </button>
  );
}

/** Drop a step, on a second tap: the step's sheet, the Start here cards, a step waited for, a carried card. `onDrop` runs once it is dropped. */
export function DropButton({ tk, onDrop, testid = 'drop' }: { tk: Tk; onDrop?: () => void; testid?: string }) {
  return (
    <ConfirmButton testid={testid} label={tk.repeat ? t('dropSeries') : t('dropIt')} confirmLabel={t('dropAgain')}
      onConfirm={() => dropTask(tk.id).then(f => { toast(droppedLine(f)); onDrop?.(); })} />
  );
}
