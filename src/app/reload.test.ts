import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadNewest } from './reload';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup(reg: Record<string, unknown> | undefined) {
  const reload = vi.fn();
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => reg, addEventListener: (k: string, f: () => void) => { listeners[k] = f; } } });
  return { reload, listeners };
}

describe('the read-only banner’s reload', () => {
  it('activates a waiting service worker and reloads once it has taken over', async () => {
    const post = vi.fn();
    const reg = { update: vi.fn(async () => undefined), waiting: { postMessage: post } };
    const { reload, listeners } = setup(reg);
    await reloadNewest();
    expect(reg.update).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    listeners.controllerchange!();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('waits for a new version that is still installing', async () => {
    const post = vi.fn();
    let change = () => {};
    const installing = { state: 'installing', postMessage: post, addEventListener: (_: string, f: () => void) => { change = f; } };
    const { listeners, reload } = setup({ update: async () => undefined, waiting: null, installing });
    const p = reloadNewest();
    await new Promise(r => setTimeout(r, 0));
    installing.state = 'installed';
    change();
    await p;
    expect(post).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    listeners.controllerchange!();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('is a plain reload with no worker waiting, or none at all', async () => {
    const a = setup({ update: async () => undefined, waiting: null, installing: null });
    await reloadNewest();
    expect(a.reload).toHaveBeenCalledTimes(1);
    const b = setup(undefined);
    await reloadNewest();
    expect(b.reload).toHaveBeenCalledTimes(1);
  });
});
