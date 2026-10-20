/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Content-Security-Policy, added to the built page only (the dev server needs inline HMR and a
// websocket). A meta CSP can't follow Settings, so connect-src allows any https: origin for the
// configurable AI endpoint (DECISIONS.md), plus the relay's own origin, which may be http on this
// computer (VITE_RELAY_URL at build time). No third-party scripts, styles or fonts.
function csp(relayUrl: string): string {
  let relay = '';
  try { relay = relayUrl ? new URL(relayUrl).origin : ''; } catch { relay = ''; }
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    ["connect-src 'self' https:", relay].filter(Boolean).join(' '), "worker-src 'self'", "manifest-src 'self'", "media-src 'self' data: blob:", "object-src 'none'", "base-uri 'self'", "form-action 'none'",
  ].join('; ');
}

export default defineConfig(({ mode }) => {
  const CSP = csp(loadEnv(mode, process.cwd(), 'VITE_').VITE_RELAY_URL ?? '');
  return {
    base: './',
    plugins: [
      preact(),
      { name: 'csp', apply: 'build', transformIndexHtml: (html: string) => html.replace('<meta charset="utf-8" />', `$&\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`) },
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/*.png', 'icons/*.svg'],
        manifest: {
          name: 'Réussite',
          short_name: 'Réussite',
          description: 'A planning app built on a CBT method for adult ADHD.',
          start_url: './#today',
          scope: './',
          display: 'standalone',
          background_color: '#F2F1F6',
          theme_color: '#6B4BA6',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        // The worker is src/sw.ts (precache, navigation fallback, push); it is still served as /sw.js.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,ico}'],
          rollupFormat: 'iife',
        },
      }),
    ],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    test: {
      include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
      environment: 'node',
    },
};
});
