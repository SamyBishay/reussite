// Hybrid logical clock. A timestamp is "<wall ms, 13 digits>:<counter, 4 digits>:<node>",
// so plain string comparison orders them: wall time first, then counter, then node id.

export type Hlc = string;

export interface Clock {
  node: string;
  wall: number;
  counter: number;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function format(wall: number, counter: number, node: string): Hlc {
  return pad(wall, 13) + ':' + pad(counter, 4) + ':' + node;
}

export function parse(h: Hlc): { wall: number; counter: number; node: string } {
  const [w, c, ...rest] = h.split(':');
  return { wall: Number(w), counter: Number(c), node: rest.join(':') };
}

export function createClock(node: string): Clock {
  return { node, wall: 0, counter: 0 };
}

/** A new timestamp for a local change. Never goes backwards, even if the device clock does. */
export function tick(clock: Clock, now = Date.now()): Hlc {
  if (now > clock.wall) {
    clock.wall = now;
    clock.counter = 0;
  } else {
    clock.counter++;
  }
  return format(clock.wall, clock.counter, clock.node);
}

/** Advance the clock past a timestamp seen from another device. */
export function receive(clock: Clock, remote: Hlc, now = Date.now()): void {
  const r = parse(remote);
  const wall = Math.max(clock.wall, r.wall, now);
  if (wall === clock.wall && wall === r.wall) clock.counter = Math.max(clock.counter, r.counter) + 1;
  else if (wall === clock.wall) clock.counter++;
  else if (wall === r.wall) clock.counter = r.counter + 1;
  else clock.counter = 0;
  clock.wall = wall;
}

export const compare = (a: Hlc, b: Hlc): number => (a < b ? -1 : a > b ? 1 : 0);
export const max = (a: Hlc | undefined, b: Hlc | undefined): Hlc | undefined =>
  a === undefined ? b : b === undefined ? a : a >= b ? a : b;

/** The zero timestamp: older than anything a device writes. Used for imported data. */
export const ZERO: Hlc = format(0, 0, '0');
