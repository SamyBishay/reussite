// Reloading into the newest version (the read-only banner: data written by a newer app). A plain
// reload keeps the old app while a new service worker is waiting, so the newer version is fetched,
// a waiting worker is told to take over (SKIP_WAITING, src/sw.ts), and the page reloads once it has.

const WAIT_MS = 10_000;

/** Wait for a worker being installed to finish (or fail), at most WAIT_MS. */
function installed(w: ServiceWorker): Promise<ServiceWorker | null> {
  return new Promise(res => {
    const done = () => { if (w.state === 'installed' || w.state === 'activated') res(w); else if (w.state === 'redundant') res(null); };
    w.addEventListener('statechange', done);
    setTimeout(() => res(null), WAIT_MS);
    done();
  });
}

export async function reloadNewest(): Promise<void> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  const reg = sw ? await sw.getRegistration().catch(() => undefined) : undefined;
  if (reg) await reg.update().catch(() => undefined); // the newer version may not have been looked for yet
  const waiting = reg?.waiting ?? (reg?.installing ? await installed(reg.installing) : null);
  if (!sw || !waiting) { location.reload(); return; }
  let gone = false;
  const go = () => { if (!gone) { gone = true; location.reload(); } };
  sw.addEventListener('controllerchange', go, { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(go, 3000); // reload anyway if the switch is never announced
}
