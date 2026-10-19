// Markdown files imported as text: wrangler's `rules` do it in the Worker, a small Vite plugin in the tests.
declare module '*.md' {
  const text: string;
  export default text;
}
