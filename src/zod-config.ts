// zod's compiled parsers probe for eval with Function('') when a schema is built, which the CSP
// (script-src 'self') blocks and the browser reports as a violation. The plain parser is fast
// enough for AI replies. Imported first in main.tsx so it runs before any schema is defined.
import { z } from 'zod';

z.config({ jitless: true });
