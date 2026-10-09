// A running timer's clock, ticking every second.
import { useEffect, useState } from 'preact/hooks';
import { elapsedSec, type T } from './model';

export function clockText(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return (h ? h + ':' + p(m) : String(m)) + ':' + p(x);
}

export function Clock({ tk, big }: { tk: T; big?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  return <span class={'clock' + (big ? '' : ' sm')}>{clockText(elapsedSec(tk, now))}</span>;
}
