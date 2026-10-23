import { describe, expect, it } from 'vitest';
import { addressOffer, personOffer, type OfferWords } from './offerPick';

const w: OfferWords = {
  goTo: 'Go to {name}', goStarter: 'Open the front door', message: 'Message {name}', messageStarter: 'Open a message to {name}', call: 'Call {name}', callStarter: 'Open Phone and call {name}',
};

describe('addressOffer', () => {
  it('sets the title, the starter, the Maps link and the address', () => {
    expect(addressOffer('a1', { name: 'Chez Louise', mapsUrl: 'https://maps.app.goo.gl/abc' }, w))
      .toEqual({ title: 'Go to Chez Louise', starter: 'Open the front door', link: 'https://maps.app.goo.gl/abc', addressId: 'a1' });
  });
  it('leaves the link out when there is none, or an unsafe one, so the step keeps its own', () => {
    expect(addressOffer('a1', { name: 'X', mapsUrl: null }, w)).not.toHaveProperty('link');
    expect(addressOffer('a1', { name: 'X', mapsUrl: 'javascript:alert(1)' }, w)).not.toHaveProperty('link');
  });
});

describe('personOffer', () => {
  it('writes to a person, with their link', () => {
    expect(personOffer('p1', { name: 'Alex', reach: 'https://wa.me/33612345678' }, w))
      .toEqual({ title: 'Message Alex', starter: 'Open a message to Alex', link: 'https://wa.me/33612345678', personId: 'p1' });
  });
  it('calls a person whose link is the phone', () => {
    expect(personOffer('p1', { name: 'Alex', reach: 'tel:+33612345678' }, w)).toMatchObject({ title: 'Call Alex', starter: 'Open Phone and call Alex', link: 'tel:+33612345678' });
  });
  it('works without a way to reach them', () => {
    const f = personOffer('p1', { name: 'Alex', reach: null }, w);
    expect(f).toEqual({ title: 'Message Alex', starter: 'Open a message to Alex', personId: 'p1' });
  });
});
