import { describe, expect, it } from 'vitest';
import { isIos, pushSupport, type PushFacts } from './support';

const base: PushFacts = { hasKey: true, hasRelay: true, capable: true, ios: false, standalone: false, permission: 'default' };

describe('pushSupport', () => {
  it('is hidden without a VAPID key', () => expect(pushSupport({ ...base, hasKey: false })).toBe('hidden'));
  it('asks an iPhone in Safari to add the app to the Home Screen first, even though PushManager is missing there', () => {
    expect(pushSupport({ ...base, ios: true, capable: false })).toBe('install');
    expect(pushSupport({ ...base, ios: true, capable: false, permission: 'granted' })).toBe('install');
  });
  it('lets the installed iPhone app go on', () => expect(pushSupport({ ...base, ios: true, standalone: true })).toBe('default'));
  it('is unsupported where the browser has no push', () => expect(pushSupport({ ...base, capable: false })).toBe('unsupported'));
  it('needs a relay address', () => expect(pushSupport({ ...base, hasRelay: false })).toBe('norelay'));
  it('otherwise follows the permission', () => {
    for (const p of ['default', 'granted', 'denied'] as const) expect(pushSupport({ ...base, permission: p })).toBe(p);
  });
});

describe('isIos', () => {
  it('recognises iPhone, iPad and iPadOS posing as a Mac, but not a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 7)', 5)).toBe(false);
  });
});
