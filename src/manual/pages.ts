// The manual's pages, in reading order. Each is a file in docs/manual/<language>/<name>.md; the first is the contents page.
export const PAGES = [
  'index', 'getting-started', 'daily-loop', 'home', 'memory', 'matrix', 'projects', 'decisions', 'places-and-trips',
  'addresses-and-people', 'calendar', 'timing-and-estimates', 'ai', 'settings', 'sync-and-recovery', 'privacy', 'faq',
] as const;
export type PageSlug = (typeof PAGES)[number];
export const isPage = (s: string): s is PageSlug => (PAGES as readonly string[]).includes(s);

// The research behind the method (docs/evidence/<language>/<slug>.md): the index, one page per rule and the method as a whole. They are
// read in the viewer and built into the public pages like the manual's own, at /manual/research and /manual/research-1 ...
export const EVIDENCE = [
  'research', 'research-1', 'research-2', 'research-3', 'research-4', 'research-5', 'research-6', 'research-7', 'research-8', 'research-9', 'research-method',
] as const;
export type EvidenceSlug = (typeof EVIDENCE)[number];
export const isEvidence = (s: string): s is EvidenceSlug => (EVIDENCE as readonly string[]).includes(s);
export type AnySlug = PageSlug | EvidenceSlug;
export const isAnyPage = (s: string): s is AnySlug => isPage(s) || isEvidence(s);
