import { describe, expect, it } from 'vitest';
import { APP_TITLE, OPEN_URL, PLAN_URL, payloadJson, payloadOf, pushToNotification } from './notification';
import { MAX_PUSH_PLAINTEXT } from './protocol';

const SCOPE = 'https://app.example/reussite/';

describe('pushToNotification', () => {
  it('turns a decrypted payload into notification options', () => {
    const n = pushToNotification({ title: 'Réussite', body: '▶ Start', tag: 'launch:2026-10-20:0', url: './#today' }, SCOPE);
    expect(n.title).toBe('Réussite');
    expect(n.options).toEqual({
      body: '▶ Start', tag: 'launch:2026-10-20:0',
      icon: SCOPE + 'icons/icon-192.png', badge: SCOPE + 'icons/favicon-32.png',
      data: { url: SCOPE + '#today' },
    });
  });

  it('reads JSON text as well as an object', () => {
    const json = payloadJson(payloadOf({ id: 'fixed:t1:2026-10-19', text: 'Leave now · 18:30' }));
    expect(pushToNotification(json, SCOPE).options.body).toBe('Leave now · 18:30');
    expect(pushToNotification(json, SCOPE).options.tag).toBe('fixed:t1:2026-10-19');
  });

  it('still shows something for a payload that is missing, plain text or the wrong shape', () => {
    for (const raw of [null, undefined, '', 42, [], ['x'], {}]) {
      const n = pushToNotification(raw, SCOPE);
      expect(n.title).toBe(APP_TITLE);
      expect(n.options.data.url).toBe(new URL(OPEN_URL, SCOPE).href);
    }
    expect(pushToNotification('just words', SCOPE).options.body).toBe('just words');
    expect(pushToNotification({ title: 7, body: {}, tag: null }, SCOPE).options).toMatchObject({ body: '', tag: '' });
  });

  it('never points a tap outside the app', () => {
    for (const url of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)', '../x']) {
      expect(pushToNotification({ url }, SCOPE).options.data.url).toBe(SCOPE + '#today');
    }
    expect(pushToNotification({ url: './#review' }, SCOPE).options.data.url).toBe(SCOPE + '#review');
  });
});

describe('payloadJson', () => {
  it('keeps a long text inside the plaintext limit, cutting on a character boundary', () => {
    const long = 'Réussite 🙂 '.repeat(200);
    const json = payloadJson(payloadOf({ id: 'x', text: long }));
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(MAX_PUSH_PLAINTEXT);
    const body = (JSON.parse(json) as { body: string }).body;
    expect(body.endsWith('…')).toBe(true);
    expect(body.includes('�')).toBe(false);
  });
  it('leaves a short one alone', () => {
    expect(JSON.parse(payloadJson(payloadOf({ id: 'a', text: 'Hi' })))).toEqual({ title: APP_TITLE, body: 'Hi', tag: 'a', url: OPEN_URL });
  });
  it('the morning notification opens the planning, every other one opens Today', () => {
    expect(payloadOf({ id: 'checkin:2026-11-02', text: 'Morning.' }).url).toBe(PLAN_URL);
    for (const id of ['fixed:t1:2026-11-02', 'close:2026-11-02', 'review:2026-11-01', 'decision:d1:2026-11-02']) expect(payloadOf({ id, text: 'x' }).url).toBe(OPEN_URL);
    expect(pushToNotification({ url: PLAN_URL }, SCOPE).options.data.url).toBe(SCOPE + '#plan');
  });
});
