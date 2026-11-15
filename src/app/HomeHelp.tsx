// The "?" next to Home's box, for people with no AI: what the local parser understands (grammar: docs/dev/home.md).
// The examples are data: English and French both read, whatever the app's language.
import { t } from '../i18n';
import { closeSheet } from './ui';

type Group = 'homeHelpAdd' | 'homeHelpSeveral' | 'homeHelpDone' | 'homeHelpMove' | 'homeHelpDrop' | 'homeHelpNote' | 'homeHelpTimer' | 'homeHelpWaiting' | 'homeHelpWhen' | 'homeHelpWhere' | 'homeHelpRepeat';
const GROUPS: { title: Group; ex: string[] }[] = [
  { title: 'homeHelpAdd', ex: ['call the bank tomorrow', 'dentist Friday 14h', 'appeler la banque demain'] },
  { title: 'homeHelpSeveral', ex: ['call the bank; buy bread friday', 'call the bank and book the dentist', 'appeler la banque puis acheter du pain'] },
  { title: 'homeHelpDone', ex: ['done the report', 'fini le rapport', 'done the report yesterday'] },
  { title: 'homeHelpMove', ex: ['move the photos to Monday', 'reporter le dentiste à vendredi'] },
  { title: 'homeHelpDrop', ex: ['drop the games', 'abandonner les jeux'] },
  { title: 'homeHelpNote', ex: ['note on the rent: the landlord wants a transfer', 'note sur le loyer : par virement'] },
  { title: 'homeHelpTimer', ex: ['start the report', 'pause', 'the report took 40 min', 'j’ai passé 1h30 sur le rapport'] },
  { title: 'homeHelpWaiting', ex: ['waiting for the parcel friday', 'en attente du colis'] },
  { title: 'homeHelpWhen', ex: ['tomorrow', 'in 3 days', 'next friday', '26 oct', 'dans 2 semaines', '19h30', '7pm', 'for 45 min', '14h-15h30'] },
  { title: 'homeHelpWhere', ex: ['piano at Hill House', 'dentiste chez Martin'] },
  { title: 'homeHelpRepeat', ex: ['choir every Wednesday 19:30', 'chorale chaque mercredi 19h30'] },
];

export function HomeHelp({ fill }: { fill: (s: string) => void }) {
  return (
    <div data-testid="home-help-sheet">
      <h3>{t('homeHelpTitle')}</h3>
      <p class="muted">{t('homeHelpIntro')}</p>
      {GROUPS.map(g => (
        <section key={g.title}>
          <h4>{t(g.title)}</h4>
          <p class="help-ex">
            {g.ex.map(x => <button type="button" class="chip" key={x} onClick={() => { closeSheet(); fill(x); }} data-testid="home-help-ex">{x}</button>)}
          </p>
        </section>
      ))}
      <p class="muted">{t('homeHelpElse')}</p>
    </div>
  );
}
