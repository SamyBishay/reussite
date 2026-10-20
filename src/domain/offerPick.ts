// What picking an offer sets on the step the planner placed (brief §5, Addresses and people, "Feeding the plan").
// Pure: the words come in from outside (the app's strings), so the same rule serves every language.
import { isAllowedLink } from './links';
import { reachKind } from './reach';
import type { Address, Person } from '../data/schema';

/** The words a picked offer is written with. `{name}` is replaced by the address's or the person's name. */
export interface OfferWords {
  goTo: string;
  goStarter: string;
  message: string;
  messageStarter: string;
  call: string;
  callStarter: string;
}

/** What is set on the step. `link` is left out when the offer has none, so the step keeps the link it had. */
export type OfferFields = {
  title: string;
  starter: string;
  link?: string;
  addressId?: string;
  personId?: string;
};

const say = (template: string, name: string) => template.replace(/\{name\}/g, () => name);

/** An address picked: go there, starting at the front door, with the Maps link when it has a safe one. */
export function addressOffer(id: string, a: Pick<Address, 'name' | 'mapsUrl'>, w: OfferWords): OfferFields {
  return {
    title: say(w.goTo, a.name), starter: say(w.goStarter, a.name),
    ...(a.mapsUrl && isAllowedLink(a.mapsUrl) ? { link: a.mapsUrl } : {}),
    addressId: id,
  };
}

/** A person picked: call them when the way to reach them is the phone, else write to them, with their link when they have one. */
export function personOffer(id: string, p: Pick<Person, 'name' | 'reach'>, w: OfferWords): OfferFields {
  const call = !!p.reach && reachKind(p.reach) === 'tel';
  return {
    title: say(call ? w.call : w.message, p.name), starter: say(call ? w.callStarter : w.messageStarter, p.name),
    ...(p.reach && isAllowedLink(p.reach) ? { link: p.reach } : {}),
    personId: id,
  };
}
