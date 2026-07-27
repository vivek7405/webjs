/**
 * The destructive token pair has to stay legible in BOTH themes, in BOTH of
 * the roles it plays.
 *
 * `--destructive` is used two ways that pull its lightness in opposite
 * directions. As a FILL it sits behind `--destructive-foreground` (the
 * destructive button and badge), which wants the fill dark enough for light
 * text or light enough for dark text. As TEXT it sits on `--card` (the alert
 * variant, `errorClass()`, a destructive menu item), which on a near-black
 * dark card wants it light. shadcn resolves the conflict with a compositing
 * trick, `dark:bg-destructive/60`, fading the fill until white text clears AA.
 * This kit resolves it by giving the fill its own foreground token instead, so
 * dark can run a LIGHT red with DARK text and keep full opacity.
 *
 * That only works while the two values stay in step, and nothing about a hand
 * edited `oklch()` triple makes a regression visible: a value that fails AA
 * looks fine in a screenshot and fails for the people who most need it not to.
 * So this test converts the real tokens out of `themes/index.css` (through
 * OKLab to sRGB) and asserts the WCAG ratio for every pairing a shipped
 * component renders, including the translucent composites.
 *
 * The margins are not all comfortable. The destructive dropdown-menu item on
 * its dark hover tint sits at 4.62:1, so a lightness nudge of a couple of
 * hundredths drops it below AA. That pairing is the reason this test computes
 * composites rather than only checking the flat colours.
 *
 * A failure here is a real accessibility regression, not a style opinion.
 * Retune the token rather than lowering the threshold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'registry');
const THEME_CSS_PATH = join(REGISTRY, 'themes', 'index.css');
const BASE_COLORS_PATH = join(REGISTRY, 'themes', 'base-colors.js');

const skip = !existsSync(THEME_CSS_PATH);

/** WCAG 2.1 minimum for normal-size body text. UI-only pairs still target it here. */
const AA = 4.5;

// --- colour maths -------------------------------------------------------
// oklch() to linear sRGB to gamma-encoded sRGB, then WCAG relative luminance.
// Kept inline because the kit ships zero runtime dependencies (invariant 2),
// and a test-only colour library would still have to be installed to run it.

const clamp = (x) => Math.min(1, Math.max(0, x));
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * Parse `oklch(L C H)` into gamma-encoded sRGB in 0..1.
 *
 * The clamp runs BEFORE the gamma encode and that order is load-bearing, not
 * incidental: an out-of-gamut colour yields a negative linear channel, and
 * `Math.pow(negative, 1 / 2.4)` is NaN. The pre-#1138 light token really did
 * produce a negative green, so encoding first would have thrown the whole
 * comparison off rather than merely clipping it.
 */
function oklch(str) {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(str);
  assert.ok(m, `not an oklch() triple: ${str}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ]
    .map(clamp)
    .map(gamma)
    .map(clamp);
}

function luminance([r, g, b]) {
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a translucent colour over an opaque one, the way `/90` renders. */
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

// --- token extraction ---------------------------------------------------

const THEME_CSS = existsSync(THEME_CSS_PATH) ? readFileSync(THEME_CSS_PATH, 'utf8') : '';

/** Read one custom property out of a `:root { … }` or `.dark { … }` block. */
function tokenIn(selector, name) {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(THEME_CSS);
  assert.ok(block, `theme block not found: ${selector}`);
  const decl = new RegExp(`--${name}:\\s*([^;]+);`).exec(block[1]);
  assert.ok(decl, `--${name} not declared in ${selector}`);
  return decl[1].trim();
}

/**
 * Resolve a mode's palette, applying a base-colour override on top of the
 * canonical neutral values so every shipped theme is covered, not just the
 * default one. Override keys are UNPREFIXED (`card`, not `--card`); the merger
 * in `base-colors.js` prepends the dashes itself, and reading them with the
 * prefix silently returns undefined for every key, which quietly turns this
 * into seven copies of the neutral assertion.
 */
function palette(mode, overrides = {}) {
  const selector = mode === 'dark' ? '\\.dark' : ':root';
  const read = (name) => oklch(overrides[name] ?? tokenIn(selector, name));
  return {
    mode,
    destructive: read('destructive'),
    destructiveForeground: read('destructive-foreground'),
    card: read('card'),
    popover: read('popover'),
    background: read('background'),
  };
}

/**
 * Every pairing a shipped component paints. The translucent entries composite
 * against the surface behind them rather than simply darkening, so each needs
 * its own check rather than being inferred from the flat colour.
 */
function pairings(p) {
  const hoverFill = over(p.destructive, p.card, 0.9);
  const alertDescription = over(p.destructive, p.card, 0.9);
  // dropdown-menu.ts tints the hovered destructive item at /10, doubled to /20
  // in dark because the tint has to read against a much darker popover.
  const menuTint = over(p.destructive, p.popover, p.mode === 'dark' ? 0.2 : 0.1);
  return [
    ['fill behind its foreground (button, badge rest)', p.destructiveForeground, p.destructive],
    ['hover fill behind its foreground (button, badge hover)', p.destructiveForeground, hoverFill],
    ['destructive as text on a card (alert, errorClass, sonner error)', p.destructive, p.card],
    ['destructive as text on the page background', p.destructive, p.background],
    ['alert description at /90 on a card', alertDescription, p.card],
    ['destructive menu item on its own hover tint', p.destructive, menuTint],
  ];
}

for (const mode of ['light', 'dark']) {
  test(`destructive tokens clear WCAG AA in ${mode} mode`, { skip }, () => {
    for (const [role, fg, bg] of pairings(palette(mode))) {
      const ratio = contrast(fg, bg);
      assert.ok(
        ratio >= AA,
        `${mode}: ${role} is ${ratio.toFixed(2)}:1, below the ${AA}:1 minimum`,
      );
    }
  });
}

test('every base colour inherits a legible destructive pair', { skip }, async () => {
  const { BASE_COLORS, BASE_OVERRIDES } = await import(BASE_COLORS_PATH);
  for (const name of BASE_COLORS) {
    const o = BASE_OVERRIDES[name];
    assert.ok(o, `${name}: no override entry`);
    for (const mode of ['light', 'dark']) {
      for (const [role, fg, bg] of pairings(palette(mode, o[mode]))) {
        const ratio = contrast(fg, bg);
        assert.ok(
          ratio >= AA,
          `theme-${name} ${mode}: ${role} is ${ratio.toFixed(2)}:1, below ${AA}:1`,
        );
      }
    }
  }
});

test('the destructive fill pairs with its foreground token, at full opacity', { skip }, () => {
  for (const file of ['button.ts', 'badge.ts']) {
    const src = readFileSync(join(REGISTRY, 'components', file), 'utf8');
    const variant = /^\s*destructive:\s*$\s*'([^']+)'/m.exec(src);
    assert.ok(variant, `${file}: destructive variant string not found`);
    const classes = variant[1];

    assert.match(
      classes,
      /\btext-destructive-foreground\b/,
      `${file}: the destructive fill must carry --destructive-foreground, not a hardcoded colour. ` +
        'The token pair is what keeps the fill legible in both themes.',
    );
    assert.doesNotMatch(
      classes,
      /\btext-white\b/,
      `${file}: white is only legible on the LIGHT theme's fill. Use the foreground token.`,
    );
    assert.doesNotMatch(
      classes,
      /dark:bg-destructive\/\d+/,
      `${file}: the dark fill runs at full opacity. Fading it reads as disabled ` +
        "(attenuation is this kit's disabled vocabulary) and the contrast it used to buy " +
        'now comes from --destructive-foreground instead.',
    );
  }
});
