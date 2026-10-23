// The manual's pages, in reading order. Each is a file in docs/manual/<language>/<name>.md; the first is the contents page.
export const PAGES = [
  'index', 'getting-started', 'daily-loop', 'home', 'memory', 'matrix', 'projects', 'decisions', 'places-and-trips',
  'addresses-and-people', 'calendar', 'timing-and-estimates', 'ai', 'settings', 'sync-and-recovery', 'privacy', 'faq',
] as const;
export type PageSlug = (typeof PAGES)[number];
export const isPage = (s: string): s is PageSlug => (PAGES as readonly string[]).includes(s);
