import { describe, expect, it } from 'vitest';
import { nextSteps, SECTION, type NextFacts } from './nextSteps';

const facts = (o: Partial<NextFacts> = {}): NextFacts => ({ relay: true, syncOn: false, keyUnsaved: false, canNotify: true, addressesOn: true, wantsConnector: false, connectorOn: false, ...o });

describe('the Next steps card', () => {
  it('offers sync, reminders and Addresses & people on a fresh device', () => {
    expect(nextSteps(facts())).toEqual(['sync', 'notify', 'addresses']);
  });
  it('puts the recovery key first, in place of the offer of sync, while it is not saved', () => {
    expect(nextSteps(facts({ syncOn: true, keyUnsaved: true }))).toEqual(['key', 'notify', 'addresses']);
    expect(nextSteps(facts({ syncOn: true }))).toEqual(['notify', 'addresses']);
  });
  it('drops what is done or cannot be done here', () => {
    expect(nextSteps(facts({ relay: false, canNotify: false, addressesOn: false }))).toEqual([]);
  });
  it('adds the connector only for someone who chose the connector, until it is on', () => {
    expect(nextSteps(facts({ wantsConnector: true }))).toEqual(['sync', 'notify', 'addresses', 'connector']);
    expect(nextSteps(facts({ wantsConnector: true, connectorOn: true }))).toEqual(['sync', 'notify', 'addresses']);
  });
  it('offers an AI and the calendar feed later, with the rest, until they are set up', () => {
    expect(nextSteps(facts({ aiOff: true, feedOff: true }))).toEqual(['sync', 'ai', 'notify', 'calendar', 'addresses']);
    expect(nextSteps(facts({ aiOff: false, feedOff: false }))).toEqual(['sync', 'notify', 'addresses']);
  });
  it('opens a Settings section for every line', () => {
    for (const l of ['key', 'sync', 'ai', 'notify', 'calendar', 'addresses', 'connector'] as const) expect(SECTION[l]).toBeTruthy();
  });
});
