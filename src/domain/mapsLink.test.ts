import { describe, expect, it } from 'vitest';
import { isMapsLink, readMapsLink, readShared, urlIn } from './mapsLink';

describe('Google Maps links', () => {
  it('reads the name of a place link, decoding + and percent-encoding', () => {
    expect(readMapsLink('https://www.google.com/maps/place/Caf%C3%A9+de+Flore/@48.8541,2.3333,17z/data=!3m1!4b1')).toEqual({ name: 'Café de Flore', lat: 48.8541, lng: 2.3333, street: null });
    expect(readMapsLink('https://www.google.com/maps/place/Boulangerie+Pâtisserie+%26+Co/')).toMatchObject({ name: 'Boulangerie Pâtisserie & Co', lat: null, lng: null });
  });
  it('prefers the pin to the centre of the map', () => {
    const r = readMapsLink('https://www.google.com/maps/place/Le+Nid/@48.1,2.1,15z/data=!4m6!3m5!1s0x1:0x2!8m2!3d48.2!4d2.3');
    expect(r).toMatchObject({ name: 'Le Nid', lat: 48.2, lng: 2.3 });
  });
  it('reads a search link and ?q=', () => {
    expect(readMapsLink('https://www.google.com/maps/search/Parc+Monceau/@48.88,2.30,15z')?.name).toBe('Parc Monceau');
    expect(readMapsLink('https://maps.google.com/?q=Mus%C3%A9e+d%27Orsay')?.name).toBe("Musée d'Orsay");
    expect(readMapsLink('https://www.google.com/maps/search/?api=1&query=Caf%C3%A9+Oz')?.name).toBe('Café Oz');
  });
  it('has no name for a short link, a bare pin or a route', () => {
    expect(readMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(readMapsLink('https://goo.gl/maps/xyz')).toBeNull();
    expect(readMapsLink('https://www.google.com/maps?q=48.85,2.33')).toBeNull();
    expect(readMapsLink('https://www.google.com/maps/place/48.85,2.33/@48.85,2.33,17z')).toBeNull();
    expect(readMapsLink('https://www.google.com/maps/dir/Gare+de+Lyon/Louvre/')).toBeNull();
    expect(readMapsLink('https://www.google.com/maps/@48.85,2.33,15z')).toBeNull();
  });
  it('is not fooled by other sites, and survives a malformed escape', () => {
    expect(readMapsLink('https://example.com/maps/place/Nope')).toBeNull();
    expect(readMapsLink('https://www.google.com/maps/place/100%+Pure')?.name).toBe('100% Pure');
    expect(readMapsLink('not a link at all')).toBeNull();
    expect(readMapsLink('')).toBeNull();
  });
});

describe('Apple Maps links', () => {
  it('reads q and ll', () => {
    expect(readMapsLink('https://maps.apple.com/?q=Chez%20Gladines&ll=48.8269,2.3469')).toEqual({ name: 'Chez Gladines', lat: 48.8269, lng: 2.3469, street: null });
    expect(readMapsLink('https://maps.apple.com/?q=Le+Petit+Zinc')?.name).toBe('Le Petit Zinc');
  });
  it('reads name, address and coordinate of a place link', () => {
    expect(readMapsLink('https://maps.apple.com/place?address=12%20Rue%20Cler,%20Paris,%20France&coordinate=48.8566,2.3059&name=Maison%20Cler&place-id=I1')).toEqual({ name: 'Maison Cler', lat: 48.8566, lng: 2.3059, street: '12 Rue Cler, Paris, France' });
  });
  it('with only an address, uses its first line as the name', () => {
    expect(readMapsLink('https://maps.apple.com/?address=1+Rue+de+Rivoli,+75001+Paris')).toEqual({ name: '1 Rue de Rivoli', lat: null, lng: null, street: '1 Rue de Rivoli, 75001 Paris' });
  });
  it('has no name for a pin with coordinates only', () => {
    expect(readMapsLink('https://maps.apple.com/?ll=48.85,2.33')).toBeNull();
    expect(readMapsLink('https://maps.apple.com/?q=48.85,2.33')).toBeNull();
    expect(readMapsLink('https://maps.apple.com/p/AbCdEfGh')).toBeNull();
  });
});

describe('pasted text', () => {
  it('finds the link and tells Maps links apart', () => {
    expect(urlIn('Café Oz\nhttps://maps.app.goo.gl/AbC12.')).toBe('https://maps.app.goo.gl/AbC12');
    expect(isMapsLink('https://maps.app.goo.gl/AbC12')).toBe(true);
    expect(isMapsLink('maps.apple.com/?q=x')).toBe(true);
    expect(isMapsLink('https://doctolib.fr')).toBe(false);
  });
  it('takes the name from the text around a short link, and from the link when it has one', () => {
    expect(readShared('Café Oz\nhttps://maps.app.goo.gl/AbC12')).toMatchObject({ url: 'https://maps.app.goo.gl/AbC12', place: { name: 'Café Oz' } });
    expect(readShared('https://maps.app.goo.gl/AbC12')).toBeNull();
    expect(readShared('Look: https://www.google.com/maps/place/Foo+Bar/@1,2,3z')?.place.name).toBe('Foo Bar');
    expect(readShared('hello')).toBeNull();
  });
});
