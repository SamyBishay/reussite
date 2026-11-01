// A way to run the suite as if it were another moment: E2E_CLOCK="HH:MM" (today, this computer's time) or "YYYY-MM-DD HH:MM". When it is set, the Node side
// of the tests (the sample's dates, the day keys the specs compute) reads that moment, ticking from there. The browser keeps its own clock: a spec
// that must not depend on the hour pins it itself (`morningClock`, `morningDate` in helpers.ts). Imported by helpers.ts and fixture.ts, so it is in place
// before any date is computed. Nothing happens when the variable is not set.
const spec = process.env.E2E_CLOCK;
if (spec) {
  const Real = Date;
  const m = /^(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{1,2}):(\d{2})$/.exec(spec.trim());
  if (!m) throw new Error('E2E_CLOCK is "HH:MM" or "YYYY-MM-DD HH:MM", got ' + spec);
  const t = new Real();
  const target = new Real(m[1] ? Number(m[1]) : t.getFullYear(), m[1] ? Number(m[2]) - 1 : t.getMonth(), m[1] ? Number(m[3]) : t.getDate(), Number(m[4]), Number(m[5]), 0, 0);
  const delta = target.getTime() - t.getTime();
  class Shifted extends Real {
    constructor(...a: unknown[]) { if (a.length) super(...(a as [number])); else super(Real.now() + delta); }
    static override now() { return Real.now() + delta; }
  }
  (globalThis as { Date: unknown }).Date = Shifted;
}
export {};
