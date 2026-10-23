// The manual, in a sheet: docs/manual/<language>/<page>.md, drawn from a small Markdown tree (markdown.ts). It is a lazy chunk, opened
// from Settings → About, so the pages and this code stay out of the main bundle. A page missing in the app's language is shown in
// English, with a line saying so. The screenshots are plain files (public/manual/shots), picked by language and theme.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { lang, t, type Lang } from '../i18n';
import { settings } from '../app/store';
import { ExtLink } from '../app/ui';
import { classifyHref, parseMarkdown, shotName, type Block, type Inline } from './markdown';
import { isPage, type PageSlug } from './pages';

const FILES = import.meta.glob('../../docs/manual/*/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

interface Loaded { slug: PageSlug; lang: Lang; blocks: Block[]; fellBack: boolean }

/** The page in this language, else in English. */
async function load(slug: PageSlug, want: Lang): Promise<Loaded | null> {
  for (const l of want === 'en' ? ['en' as const] : [want, 'en' as const]) {
    const f = FILES[`../../docs/manual/${l}/${slug}.md`];
    if (f) return { slug, lang: l, blocks: parseMarkdown(await f()), fellBack: l !== want };
  }
  return null;
}

/** The look in force: the chosen theme, or the device's when the setting is System (or By time of day, which the app has already turned into one). */
function useShotTheme(): 'light' | 'dark' {
  void settings.value.theme;
  const read = (): 'light' | 'dark' => {
    const a = document.documentElement.getAttribute('data-theme');
    return a === 'dark' || a === 'light' ? a : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    on();
    return () => { mq.removeEventListener('change', on); mo.disconnect(); };
  }, []);
  return v;
}

function Inlines({ c, go, shots }: { c: Inline[]; go: (s: PageSlug) => void; shots: string }) {
  return <>{c.map(x => <One x={x} go={go} shots={shots} />)}</>;
}
function One({ x, go, shots }: { x: Inline; go: (s: PageSlug) => void; shots: string }): ComponentChildren {
  if (x.t === 'text') return x.v;
  if (x.t === 'code') return <code>{x.v}</code>;
  if (x.t === 'b') return <strong><Inlines c={x.c} go={go} shots={shots} /></strong>;
  if (x.t === 'i') return <em><Inlines c={x.c} go={go} shots={shots} /></em>;
  if (x.t === 'img') return <Shot name={shotName(x.src)} alt={x.alt} dir={shots} />;
  const to = classifyHref(x.href);
  const inner = <Inlines c={x.c} go={go} shots={shots} />;
  if (to.kind === 'page' && isPage(to.slug)) return <a href="#" class="lnk wrap" onClick={e => { e.preventDefault(); go(to.slug as PageSlug); }}>{inner}</a>;
  if (to.kind === 'out') return <ExtLink href={to.href} class="lnk wrap">{inner}</ExtLink>;
  return <>{inner}</>;
}

/** A screenshot, or its description when the picture is not there (offline, or not made for this look). */
function Shot({ name, alt, dir }: { name: string | null; alt: string; dir: string }) {
  const [bad, setBad] = useState(false);
  if (!name) return <>{alt}</>;
  if (bad) return <em class="shot-alt">{alt}</em>;
  return <img class="shot" src={`manual/shots/${dir}/${name}.png`} alt={alt} width="375" loading="lazy" onError={() => setBad(true)} />;
}

function Blocks({ blocks, go, shots }: { blocks: Block[]; go: (s: PageSlug) => void; shots: string }) {
  const I = (c: Inline[]) => <Inlines c={c} go={go} shots={shots} />;
  return (
    <>
      {blocks.map(b => {
        if (b.t === 'h') { const H = ('h' + Math.min(4, b.n + 1)) as 'h2'; return b.n === 1 ? <h2 class="man-h1">{I(b.c)}</h2> : <H>{I(b.c)}</H>; }
        if (b.t === 'ul') return <ul>{b.items.map(i => <li>{I(i)}</li>)}</ul>;
        if (b.t === 'ol') return <ol>{b.items.map(i => <li>{I(i)}</li>)}</ol>;
        if (b.t === 'quote') return <blockquote>{I(b.c)}</blockquote>;
        if (b.t === 'pre') return <pre>{b.v}</pre>;
        if (b.t === 'hr') return <hr />;
        // A paragraph that is only a picture is a figure.
        if (b.c.length === 1 && b.c[0]!.t === 'img') return <figure>{I(b.c)}</figure>;
        return <p>{I(b.c)}</p>;
      })}
    </>
  );
}

export function ManualSheet() {
  const [slug, setSlug] = useState<PageSlug>('index');
  const [page, setPage] = useState<Loaded | null | undefined>(undefined);
  const top = useRef<HTMLDivElement>(null);
  const theme = useShotTheme();
  const want = lang.value;
  useEffect(() => {
    let live = true;
    setPage(undefined);
    void load(slug, want).then(p => { if (live) { setPage(p); (top.current?.closest('.sheet') as HTMLElement | null)?.scrollTo(0, 0); } }, () => { if (live) setPage(null); });
    return () => { live = false; };
  }, [slug, want]);
  return (
    <div class="manual" data-testid="manual" ref={top}>
      <h3>{t('manualTitle')}</h3>
      {slug !== 'index' && <p class="man-nav"><a href="#" class="lnk" onClick={e => { e.preventDefault(); setSlug('index'); }} data-testid="manual-contents">← {t('manualContents')}</a></p>}
      {page === undefined && <p class="hint">{t('manualLoading')}</p>}
      {page === null && <p class="err">{t('manualMissing')}</p>}
      {page && (
        <article lang={page.lang} data-page={page.slug}>
          {page.fellBack && <p class="hint">{t('manualNotTranslated')}</p>}
          <Blocks blocks={page.blocks} go={setSlug} shots={`${page.lang}-${theme}`} />
          {slug !== 'index' && <p class="man-nav"><a href="#" class="lnk" onClick={e => { e.preventDefault(); setSlug('index'); }}>← {t('manualContents')}</a></p>}
        </article>
      )}
    </div>
  );
}
