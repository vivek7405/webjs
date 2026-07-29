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
  { token: '--bg', name: 'Canvas', role: 'Page background', dark: 'oklch(0.115 0.003 60)', light: 'oklch(0.99 0.002 75)' },
  { token: '--bg-elev', name: 'Raised', role: 'Cards and panels', dark: 'oklch(0.155 0.004 60)', light: 'oklch(1 0 0)' },
  { token: '--bg-subtle', name: 'Subtle', role: 'Hover and inset fills', dark: 'oklch(0.185 0.004 60)', light: 'oklch(0.965 0.003 75)' },
  { token: '--bg-sunken', name: 'Sunken', role: 'Code surfaces', dark: 'oklch(0.088 0.003 60)', light: 'oklch(0.945 0.004 70)' },
  { token: '--fg', name: 'Ink', role: 'Headings and body', dark: 'oklch(0.97 0.004 70)', light: 'oklch(0.19 0.006 60)' },
  { token: '--fg-muted', name: 'Ink muted', role: 'Supporting prose', dark: 'oklch(0.71 0.006 65)', light: 'oklch(0.45 0.008 60)' },
  { token: '--fg-subtle', name: 'Ink subtle', role: 'Captions and metadata', dark: 'oklch(0.56 0.007 60)', light: 'oklch(0.57 0.008 62)' },
  { token: '--border', name: 'Line', role: 'Dividers and outlines', dark: 'oklch(1 0 0 / 0.10)', light: 'oklch(0.89 0.004 70 / 0.9)' },
];

/** The three stops of the signature ramp, amber through orange into magenta. */
export const RAMP: Swatch[] = [
  { token: '--accent', name: 'Amber', role: 'Ramp start, and the flat brand colour', dark: 'oklch(0.80 0.16 65)', light: 'oklch(0.55 0.16 52)' },
  { token: '--accent-mid', name: 'Orange', role: 'Ramp midpoint', dark: 'oklch(0.74 0.19 30)', light: 'oklch(0.57 0.21 28)' },
  { token: '--accent-2', name: 'Magenta', role: 'Ramp end', dark: 'oklch(0.68 0.24 358)', light: 'oklch(0.55 0.24 356)' },
];
