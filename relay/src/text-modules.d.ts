// Markdown files imported as text: wrangler's `rules` do it in the Worker, a small Vite plugin in the tests.
declare module '*.md' {
  const text: string;
  export default text;
}

// The CORS test reads the Worker's config as text (Vite's `?raw`).
declare module '*?raw' {
  const text: string;
  export default text;
}
