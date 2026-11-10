// Slots (plan 10 Nov): time set aside to work on a step. The chip on a card, the sheet that sets or re-slots one, the fields the card sheet
// shares with it, and the log of where the slot has been. A slot is never an event: it writes `slot` and `slotLog` and nothing else.
import { useState } from 'preact/hooks';
import { today, toast, hereZone, clockNow } from './store';
import { openSheet, closeSheet } from './sheet';
import { setSlot } from './actions';
import { T, dayOrderOf, slotStateOf, isOpen } from './model';
import { t, fmtDate } from '../i18n';
import { addDays } from '../domain/dates';
import { wallOf } from '../domain/zone';
import { readSlot, slotEnd, MIN_SLOT } from '../domain/slots';
import type { Slot, SlotLogEntry, Task } from '../data/schema';

const dayText = (k: string) => (k === today.value ? '' : fmtDate(k));
/** "slot 14:00–14:45", with the day when it is not today, "slot passed …" once its end has gone. */
export function slotText(s: Slot, passed = false): string {
  const vars = { from: s.at, to: slotEnd(s), date: dayText(s.day) };
  return passed ? t('slotPassedChip', vars) : s.day === today.value ? t('slotChip', vars) : t('slotChipDay', vars);
}

/** The next five-minute mark after now: where a new slot starts when nothing says otherwise. */
const nextMark = (): string => {
  const w = wallOf(clockNow.value, hereZone.value), m = Math.ceil((Number(w.slice(0, 2)) * 60 + Number(w.slice(3)) + 1) / 5) * 5;
  const n = Math.min(m, 23 * 60 + 55);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
};

/**
 * What a new slot would be, offered and never written: today's one order puts the step at its projected start, else the next five-minute
 * mark; as long as the old slot (else its estimate, else 30 minutes).
 */
export function proposeSlot(tk: Task & { id: string }): Slot {
  const x = dayOrderOf(today.value).order.find(o => o.kind === 'step' && o.id === tk.id);
  const at = x ? wallOf(x.start, hereZone.value) : nextMark();
  return { day: today.value, at, dur: readSlot(tk.slot)?.dur ?? tk.est ?? 30 };
}

/** The chip on a card: its slot, or "slot passed" with Re-slot once the end has gone and the step is still open. */
export function SlotChip({ tk }: { tk: Task & { id: string } }) {
  const s = readSlot(tk.slot);
  if (!s || !isOpen(tk)) return null;
  const passed = slotStateOf(s) === 'passed';
  return (
    <button type="button" class={'slotchip' + (passed ? ' passed' : '')} data-testid={passed ? 'slot-passed' : 'slot-chip'} onClick={e => { e.stopPropagation(); openSlot(tk.id); }}
      aria-label={passed ? t('slotReslot') + ': ' + slotText(s, true) : slotText(s)}>
      {slotText(s, passed)}{passed && <> · <b>{t('slotReslot')}</b></>}
    </button>
  );
}

export function openSlot(id: string) {
  openSheet(<SlotSheet key={'slot' + id} id={id} />);
}

/** The slot's three inputs, in a form: a day, a start and a length, and a button that empties them (a time input cannot always be cleared by hand). Read back by `slotFromForm`. */
export function SlotFields({ value }: { value: Slot | null }) {
  // The inputs are uncontrolled and made again (a new key) when emptied: WebKit leaves a date or time input that was set to '' by script
  // with bad input, which stops the form from being sent.
  const [vals, setVals] = useState({ day: value?.day ?? '', at: value?.at ?? '', dur: value ? String(value.dur) : '' }), [gen, setGen] = useState(0);
  const on = (k: 'day' | 'at' | 'dur') => (e: Event) => setVals(v => ({ ...v, [k]: (e.target as HTMLInputElement).value }));
  return (
    <>
      <div class="row3 slotfields" data-testid="slot-fields" key={gen}>
        <label class="field"><span>{t('day')}</span><input type="date" name="slotDay" defaultValue={vals.day} onInput={on('day')} data-testid="slot-day" /></label>
        <label class="field"><span>{t('slotStart')}</span><input type="time" name="slotAt" defaultValue={vals.at} onInput={on('at')} data-testid="slot-at" /></label>
        <label class="field"><span>{t('slotLen')}</span><input type="number" name="slotDur" min={MIN_SLOT} max="720" inputMode="numeric" defaultValue={vals.dur} onInput={on('dur')} data-testid="slot-dur" /></label>
      </div>
      {(vals.day || vals.at || vals.dur) && <p class="hint"><button class="btn small ghost" type="button" data-testid="slot-clear" onClick={() => { setVals({ day: '', at: '', dur: '' }); setGen(g => g + 1); }}>{t('slotRemove')}</button></p>}
    </>
  );
}

/** A slot from the three inputs, or null when they are empty or incomplete. A start with no day is today; no length is 30 minutes. */
export function slotFromForm(get: (name: string) => string): Slot | null {
  const at = get('slotAt');
  if (!at) return null;
  return readSlot({ day: get('slotDay') || today.value, at, dur: Number(get('slotDur')) || 30 });
}

const WHY = { planned: 'slotWhyPlanned', set: 'slotWhySet', moved: 'slotWhyMoved', reslotted: 'slotWhyReslotted', cleared: 'slotWhyCleared' } as const;
const short = (s: Slot | null) => (s ? `${s.day === today.value ? '' : fmtDate(s.day) + ' '}${s.at}–${slotEnd(s)}` : t('slotNone'));

/** Where the slot has been, newest last: the log that makes re-slotting safe. */
export function SlotLog({ tk }: { tk: Task }) {
  const log: SlotLogEntry[] = Array.isArray(tk.slotLog) ? tk.slotLog : [];
  if (!log.length) return null;
  return (
    <div class="slotlog" data-testid="slot-log">
      <p class="hint">{t('slotLogTitle')}</p>
      <ul class="mini">
        {log.map(e => <li>{t('slotLogLine', { when: fmtDate(e.at.slice(0, 10)) + ' ' + wallOf(Date.parse(e.at), hereZone.value), from: short(readSlot(e.from)), to: short(readSlot(e.to)), why: t(WHY[e.why] ?? 'slotWhySet') })}{e.by === 'ai' ? ' · ' + t('slotBy', { who: 'AI' }) : ''}</li>)}
      </ul>
    </div>
  );
}

/** Set, move, re-slot or remove a slot. Re-slot opens with a proposal; nothing is written until the person confirms. */
function SlotSheet({ id }: { id: string }) {
  const tk = T(id);
  const cur = tk ? readSlot(tk.slot) : null;
  const passed = !!cur && !!tk && isOpen(tk) && slotStateOf(cur) === 'passed';
  const [start] = useState<Slot | null>(() => (tk ? (passed || !cur ? proposeSlot(tk) : cur) : null));
  if (!tk) return null;
  const submit = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const to = slotFromForm(n => String(f.get(n) ?? ''));
    if (!to) return;
    closeSheet();
    void setSlot(id, to, passed ? 'reslotted' : cur ? 'moved' : 'set').then(() => toast(t('saved')));
  };
  return (
    <form onSubmit={submit} data-testid="slot-sheet">
      <h3>{passed ? t('slotReslotTitle') : t('slotTitle')}</h3>
      <p class="hint">{tk.title}</p>
      <p class="hint">{passed ? t('slotReslotHint') : t('slotHint')}</p>
      <SlotFields value={start} />
      <div class="actions">
        <button class="btn primary" type="submit" data-testid="slot-save">{passed ? t('slotReslot') : t('slotSet')}</button>
        {cur && <button class="btn ghost" type="button" data-testid="slot-remove" onClick={() => { closeSheet(); void setSlot(id, null, 'cleared'); }}>{t('slotRemove')}</button>}
      </div>
      <SlotLog tk={tk} />
    </form>
  );
}
