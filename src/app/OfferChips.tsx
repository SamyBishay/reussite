// The planner's offers (brief §5, Addresses and people, "Feeding the plan"): where a placed leisure obligation could go,
// or who a people obligation could be with. Up to three, in the current place; picking one is optional and changes
// only the step that is about to be made, never the standing obligation. Shown nowhere when the module is off or the lists are empty.
import { here } from './store';
import { addressById, offerAddressesNow, offerPeopleNow, personById } from './model';
import { addressOffer, personOffer, type OfferWords } from '../domain/offerPick';
import { t } from '../i18n';
import type { Offer, Task } from '../data/schema';

/** What was picked: nothing (null) keeps the step as the standing obligation has it. */
export type OfferChoice = { kind: Offer; id: string } | null;

const words = (): OfferWords => ({
  goTo: t('offerGoTo', { name: '{name}' }), goStarter: t('offerGoStarter'),
  message: t('offerMessage', { name: '{name}' }), messageStarter: t('offerMessageStarter', { name: '{name}' }),
  call: t('offerCall', { name: '{name}' }), callStarter: t('offerCallStarter', { name: '{name}' }),
});

/** The fields a pick sets on the step; none for no pick, or when what was picked is gone. */
export function offerFieldsFor(c: OfferChoice | undefined): Partial<Task> {
  if (!c) return {};
  if (c.kind === 'address') { const a = addressById(c.id); return a ? addressOffer(c.id, a, words()) : {}; }
  const p = personById(c.id);
  return p ? personOffer(c.id, p, words()) : {};
}

/** The names to choose between for a standing obligation's `offer`, in the offer's own order. */
export function offerList(offer: Offer | null | undefined, place = here.value): { id: string; name: string }[] {
  if (offer === 'address') return offerAddressesNow(null, place).map(a => ({ id: a.id, name: a.name }));
  if (offer === 'person') return offerPeopleNow(place).map(p => ({ id: p.id, name: p.name }));
  return [];
}

export function OfferChips({ offer, value, onChange, place }: { offer: Offer | null | undefined; value: OfferChoice | undefined; onChange: (c: OfferChoice) => void; place?: string }) {
  const list = offerList(offer, place);
  if (!offer || !list.length) return null;
  return (
    <div class="offers" data-testid="offers" role="group" aria-label={t(offer === 'address' ? 'offerAskAddress' : 'offerAskPerson')}>
      <p class="field-label">{t(offer === 'address' ? 'offerAskAddress' : 'offerAskPerson')}</p>
      <div class="chips-pick small">
        {list.map(o => (
          <button type="button" data-testid="offer" aria-pressed={value?.id === o.id} onClick={() => onChange(value?.id === o.id ? null : { kind: offer, id: o.id })}>{o.name}</button>
        ))}
        <button type="button" data-testid="offer-keep" aria-pressed={!value} onClick={() => onChange(null)}>{t('offerKeep')}</button>
      </div>
    </div>
  );
}
