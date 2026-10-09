import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/private/*.check.ts'], environment: 'node' } });
