import { describe, expect, it } from 'vitest';
import { modeOf, statusLines, type StatusFacts } from './understand';

const base: StatusFacts = { relay: true, syncOn: false, keySaved: false, connectorOn: null, lastUsed: null, provider: 'none', hasKey: false, keyTest: null };
const by = (f: Partial<StatusFacts>) => Object.fromEntries(statusLines({ ...base, ...f }).map(l => [l.id, l]));

describe('the choice', () => {
  it('is this device on a new install, a cloud AI with a provider or the connector, and what was tapped last above all', () => {
    expect(modeOf({ provider: 'none', connectorOn: false, picked: null })).toBe('device');
    expect(modeOf({ provider: 'anthropic', connectorOn: false, picked: null })).toBe('cloud');
    expect(modeOf({ provider: 'none', connectorOn: true, picked: null })).toBe('cloud');
    // On this device chosen while the connector stays on: the screen shows the choice, the connector keeps its own switch.
    expect(modeOf({ provider: 'none', connectorOn: true, picked: 'device' })).toBe('device');
    expect(modeOf({ provider: 'none', connectorOn: false, picked: 'cloud' })).toBe('cloud');
  });
});

describe('the status list', () => {
  it('has five lines in order, none done on a new install, each going to the piece that does it', () => {
    const ls = statusLines(base);
    expect(ls.map(l => l.id)).toEqual(['sync', 'recovery', 'connector', 'chatApp', 'key']);
    expect(ls.every(l => !l.done)).toBe(true);
    expect(ls.map(l => l.go)).toEqual(['sync', 'sync', 'connector', 'connector', 'ai-settings']);
  });
  it('without a sync server, sync and its key lead nowhere on this screen', () => {
    const l = by({ relay: false });
    expect(l.sync).toMatchObject({ state: 'off', done: false });
    expect(l.sync!.go).toBeUndefined();
    expect(l.recovery!.go).toBeUndefined();
  });
  it('sync on with the key not saved opens the key; saved is done', () => {
    expect(by({ syncOn: true }).recovery).toMatchObject({ state: 'unsaved', go: 'show-key' });
    expect(by({ syncOn: true, keySaved: true }).recovery).toMatchObject({ state: 'saved', done: true });
    expect(by({ syncOn: true }).sync).toMatchObject({ state: 'on', done: true });
  });
  it('the connector: unknown while the relay has not answered, off, on; the chat app is seen only once it came in', () => {
    expect(by({ syncOn: true }).connector).toMatchObject({ state: 'unknown', done: false });
    expect(by({ syncOn: true, connectorOn: false }).connector).toMatchObject({ state: 'off', go: 'connector' });
    expect(by({ syncOn: true, connectorOn: true }).connector).toMatchObject({ state: 'on', done: true });
    expect(by({ syncOn: true, connectorOn: true }).chatApp).toMatchObject({ state: 'never', go: 'connector' });
    expect(by({ syncOn: true, connectorOn: true, lastUsed: 1 }).chatApp).toMatchObject({ state: 'seen', done: true });
    // A time from before the connector went off is not "linked".
    expect(by({ syncOn: true, connectorOn: false, lastUsed: 1 }).chatApp).toMatchObject({ state: 'never', done: false });
  });
  it('the key: none, untested, failed, works', () => {
    expect(by({ provider: 'anthropic' }).key).toMatchObject({ state: 'noKey', go: 'ai-settings' });
    expect(by({ provider: 'anthropic', hasKey: true }).key).toMatchObject({ state: 'untested', go: 'ai-settings' });
    expect(by({ provider: 'anthropic', hasKey: true, keyTest: 'failed' }).key).toMatchObject({ state: 'failed', done: false });
    expect(by({ provider: 'anthropic', hasKey: true, keyTest: 'ok' }).key).toMatchObject({ state: 'works', done: true });
    expect(by({ provider: 'none', hasKey: true, keyTest: 'ok' }).key).toMatchObject({ state: 'noKey' });
  });
});
