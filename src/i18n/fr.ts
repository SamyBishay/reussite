// Chaînes françaises. Les espaces fines insécables (avant ; : ! ? et dans « ») sont
// ajoutées automatiquement par frTypo : tapez des espaces ordinaires.
// A key missing here falls back to English; missing keys are translated in one batch per phase.
// The strings are in four parts (src/i18n/parts/fr-*.ts); this file puts them together.
import type { Strings } from './en';
import { frCore } from './parts/fr-core';
import { frSteps } from './parts/fr-steps';
import { frAi } from './parts/fr-ai';
import { frHome } from './parts/fr-home';

export const fr: Partial<Strings> = { ...frCore, ...frSteps, ...frAi, ...frHome };
