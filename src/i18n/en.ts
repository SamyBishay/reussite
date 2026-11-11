// English strings. fr.ts must have every key (the type checks it).
// The strings are in four parts (src/i18n/parts/en-*.ts); this file puts them together and gives the type.
import { enCore } from './parts/en-core';
import { enSteps } from './parts/en-steps';
import { enAi } from './parts/en-ai';
import { enHome } from './parts/en-home';

export const en = { ...enCore, ...enSteps, ...enAi, ...enHome };

export type Strings = typeof en;
