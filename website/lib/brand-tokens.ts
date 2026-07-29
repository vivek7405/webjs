/**
 * The palette, as data.
 *
 * /brand used to hand-write hex values ("#E59500") next to token names while
 * app/layout.ts declared the real values in oklch. The two drifted immediately,
 * and the page shipped describing an accent colour the site did not use.
 *
 * The values here are the same oklch triples the layout declares, in one list,
 * so the brand page renders swatches by painting the token itself rather than
 * by restating a colour. A swatch that disagrees with the site is now a visible
 * bug on the page rather than a caption nobody re-reads.
 */

export type Swatch = {
  /** The custom property, exactly as declared in the root layout. */
  token: string;
  name: string;
  /** What it is for. */
  role: string;
  dark: string;
  light: string;
};

export const SWATCHES: Swatch[] = [
  { token: '--bg', name: 'Canvas', role: 'Page background', dark: 'oklch(0 0 0)', light: 'oklch(0.985 0.008 75)' },
  { token: '--bg-elev', name: 'Raised', role: 'Cards and panels', dark: 'oklch(0.135 0 0)', light: 'oklch(1 0 0)' },
  { token: '--bg-subtle', name: 'Subtle', role: 'Hover and inset fills', dark: 'oklch(0.09 0 0)', light: 'oklch(0.96 0.008 75)' },
  { token: '--bg-sunken', name: 'Sunken', role: 'Code surfaces', dark: 'oklch(0 0 0)', light: 'oklch(0.93 0.01 70)' },
  { token: '--fg', name: 'Ink', role: 'Headings and body', dark: 'oklch(0.96 0 0)', light: 'oklch(0.20 0.018 60)' },
  { token: '--fg-muted', name: 'Ink muted', role: 'Supporting prose', dark: 'oklch(0.74 0 0)', light: 'oklch(0.44 0.02 60)' },
  { token: '--fg-subtle', name: 'Ink subtle', role: 'Captions and metadata', dark: 'oklch(0.62 0 0)', light: 'oklch(0.50 0.02 65)' },
  { token: '--border', name: 'Line', role: 'Dividers and outlines', dark: 'oklch(0.32 0 0 / 0.9)', light: 'oklch(0.88 0.012 70 / 0.9)' },
];

/**
 * The accent, kept separate from the neutrals above because it is governed by
 * a rule rather than by a surface: it belongs on the things asking for a
 * click, and nowhere else.
 *
 * It is lighter in dark mode and darker in light mode for the same reason in
 * both cases, contrast against the page. That flip is also why --accent-fg
 * exists: amber at 0.82 lightness takes near-black text (9.9:1), amber at 0.54
 * takes white (5.4:1).
 */
export const ACCENTS: Swatch[] = [
  { token: '--accent', name: 'Amber', role: 'Primary button, closing CTA', dark: 'oklch(0.82 0.15 52)', light: 'oklch(0.54 0.16 52)' },
  { token: '--accent-fg', name: 'On amber', role: 'Text and icons on the accent', dark: 'oklch(0.17 0.02 52)', light: 'oklch(1 0 0)' },
  { token: '--accent-live', name: 'Live', role: 'Glow, live dots, focus rings', dark: 'oklch(0.80 0.14 52)', light: 'oklch(0.63 0.17 50)' },
];
