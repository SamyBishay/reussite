// The mark: the heart of Hilma af Klint's The Dove (1915), cut out of the painting (scripts/dove, docs/dev/dove.md).
// The light painting's heart on the light ground, the dark one's on the dark; the hidden one is never fetched.
// The app icon is the dark heart (public/icons).
const DARK = new URL('../assets/dove/mark-dark.webp', import.meta.url).href;
const LIGHT = new URL('../assets/dove/mark-light.webp', import.meta.url).href;

export function Mark({ size = 64, class: cls }: { size?: number; class?: string }) {
  return (
    <span class={'mark' + (cls ? ' ' + cls : '')} style={{ height: size + 'px' }} aria-hidden="true">
      <img class="mark-l" src={LIGHT} alt="" height={size} loading="lazy" decoding="async" />
      <img class="mark-d" src={DARK} alt="" height={size} loading="lazy" decoding="async" />
    </span>
  );
}
