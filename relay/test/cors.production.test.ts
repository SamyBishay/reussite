// The production allow-list in wrangler.jsonc must cover the app and its Workers Builds preview URLs.
import { describe, expect, it } from 'vitest';
import config from '../wrangler.jsonc?raw';
import { originAllowed } from '../src/cors';
import type { Env } from '../src/env';

const list = /"ALLOWED_ORIGINS":\s*"([^"]+)"/.exec(config)![1]!;
const env = { ALLOWED_ORIGINS: list } as Env;

describe('production CORS allow-list', () => {
  it('allows the app and its preview URLs (version prefix or branch alias)', () => {
    for (const o of [
      'https://reussite.rudolphem.workers.dev',
      'https://a1b2c3d4-reussite.rudolphem.workers.dev',
      'https://phase-3-reussite.rudolphem.workers.dev',
    ]) expect(originAllowed(o, env), o).toBe(true);
  });
  it('refuses lookalikes, other hosts and plain http', () => {
    for (const o of [
      'https://reussite.rudolphem.workers.dev.evil.com',
      'https://x.y-reussite.rudolphem.workers.dev',
      'http://reussite.rudolphem.workers.dev',
      'https://reussite.other.workers.dev',
      'https://d1-reussite.evil.workers.dev',
    ]) expect(originAllowed(o, env), o).toBe(false);
  });
});
