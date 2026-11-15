import { describe, expect, it } from 'vitest';
import { ALL_TABS, NO_TABS, factsOf, featureOn, fromBefore, reviewWaits, tabEarned, tabShown, tabsToOpen, type DeckFacts } from './start';

const none: DeckFacts = { cards: 0, open: 0, fixed: false, projects: 0, reviewed: false };
const card = (o: Record<string, unknown> = {}) => ({ status: 'open', template: false, ...o });

describe('the deck as the rules count it', () => {
  it('counts cards open or played, not standing items, events, dropped cards or the ritual\'s planning card', () => {
    const f = factsOf([card(), card({ status: 'done' }), card({ template: true }), card({ kind: 'event' }), card({ status: 'dropped' }), card({ status: 'done', src: 'plan' })], [], []);
    expect(f).toMatchObject({ cards: 2, open: 1, fixed: false });
  });
  it('a fixed time on a card or a standing item counts; on an event or a dropped card it does not', () => {
    expect(factsOf([card({ at: '15:00' })], [], []).fixed).toBe(true);
    expect(factsOf([card({ template: true, at: '19:00' })], [], []).fixed).toBe(true);
    expect(factsOf([card({ kind: 'event', at: '10:00' }), card({ status: 'dropped', at: '10:00' })], [], []).fixed).toBe(false);
  });
  it('the Inbox is not a project; a day with a review means a review was done', () => {
    expect(factsOf([], [{ id: 'inbox' }, { id: 'p1' }], [{ review: null }, { review: '2026-11-08T18:00:00Z' }])).toMatchObject({ projects: 1, reviewed: true });
  });
});

describe('tabs that appear', () => {
  it('Calendar with the first card that has a fixed time', () => {
    expect(tabEarned('calendar', none)).toBe(false);
    expect(tabEarned('calendar', { ...none, fixed: true })).toBe(true);
  });
  it('Projects with the first project or at eight cards', () => {
    expect(tabEarned('projects', { ...none, cards: 7 })).toBe(false);
    expect(tabEarned('projects', { ...none, cards: 8 })).toBe(true);
    expect(tabEarned('projects', { ...none, projects: 1 })).toBe(true);
  });
  it('the Matrix at twelve open cards or the first weekly review', () => {
    expect(tabEarned('matrix', { ...none, cards: 20, open: 11 })).toBe(false);
    expect(tabEarned('matrix', { ...none, open: 12 })).toBe(true);
    expect(tabEarned('matrix', { ...none, reviewed: true })).toBe(true);
  });
  it('a tab once shown stays, whatever the deck becomes; one earned shows before it is recorded', () => {
    expect(tabShown('matrix', { ...NO_TABS, matrix: true }, none)).toBe(true);
    expect(tabShown('calendar', NO_TABS, { ...none, fixed: true })).toBe(true);
    expect(tabShown('projects', NO_TABS, none)).toBe(false);
  });
  it('only the tabs earned and not yet recorded are to open (and to announce)', () => {
    expect(tabsToOpen(NO_TABS, { ...none, fixed: true, cards: 8 })).toEqual(['calendar', 'projects']);
    expect(tabsToOpen({ ...NO_TABS, calendar: true }, { ...none, fixed: true })).toEqual([]);
    expect(tabsToOpen(ALL_TABS, { ...none, fixed: true, cards: 50, open: 50, reviewed: true })).toEqual([]);
  });
  it('an install from before (every tab on, the default) shows them all on an empty deck', () => {
    for (const x of ['calendar', 'projects', 'matrix'] as const) expect(tabShown(x, ALL_TABS, none)).toBe(true);
  });
});

describe('switches that are off for a new install', () => {
  it('an install from before: the switch alone decides, as before', () => {
    expect(featureOn(true, '', false)).toBe(true);
    expect(featureOn(false, '', true)).toBe(false);
  });
  it('a new install: off until turned on, or until such data exists', () => {
    expect(featureOn(false, '2026-11-15T09:00:00.000Z', false)).toBe(false);
    expect(featureOn(false, '2026-11-15T09:00:00.000Z', true)).toBe(true);
    expect(featureOn(true, '2026-11-15T09:00:00.000Z', false)).toBe(true);
  });
});

describe('the weekly review waits', () => {
  const since = '2026-11-15T09:00:00.000Z';
  it('never on an install from before', () => {
    expect(reviewWaits('', '2026-11-15', { cards: 0, reviewed: false })).toBe(false);
  });
  it('until the deck is a week old and holds ten cards', () => {
    expect(reviewWaits(since, '2026-11-21', { cards: 30, reviewed: false })).toBe(true);
    expect(reviewWaits(since, '2026-11-22', { cards: 9, reviewed: false })).toBe(true);
    expect(reviewWaits(since, '2026-11-22', { cards: 10, reviewed: false })).toBe(false);
  });
  it('not once a review was done', () => {
    expect(reviewWaits(since, '2026-11-16', { cards: 1, reviewed: true })).toBe(false);
  });
});

describe('a deck from before the set-up', () => {
  const since = '2026-11-15T09:00:00.000Z';
  it('anything made before the set-up means the deck is not new', () => {
    expect(fromBefore(since, ['2026-11-15T09:05:00.000Z', '2026-09-01T09:00:00Z'])).toBe(true);
    expect(fromBefore(since, ['2026-11-15T09:05:00.000Z', undefined, null, ''])).toBe(false);
  });
  it('an install from before has nothing to compare with', () => {
    expect(fromBefore('', ['2020-01-01T00:00:00Z'])).toBe(false);
  });
});
