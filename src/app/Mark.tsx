// Logo A (brief §16): a heart with the dragon's concentric rings at its centre, in the theme's colours.
// The app icon is the same drawing (public/icons/icon.svg).
export function Mark({ size = 64, class: cls }: { size?: number; class?: string }) {
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <path d="M256 456C148 384 60 306 60 196A100 100 0 0 1 256 142A100 100 0 0 1 452 196C452 306 364 384 256 456Z" style="fill:var(--mark-heart)" />
      <circle cx="256" cy="258" r="112" style="fill:var(--ground)" />
      <circle cx="256" cy="258" r="86" style="fill:var(--mark-ring)" />
      <circle cx="256" cy="258" r="50" style="fill:var(--ground)" />
      <circle cx="256" cy="258" r="22" style="fill:var(--mark-dot)" />
    </svg>
  );
}
