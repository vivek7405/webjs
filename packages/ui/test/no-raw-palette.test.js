/**
 * The kit's own source may not name a Tailwind palette family (#1116).
 *
 * This is the regression test for the semantic ramps, and it could only turn
 * green once they existed: `sonner.ts` carried `text-emerald-500`,
 * `text-sky-500` and `text-amber-500` because there was no `--success`,
 * `--info` or `--warning` token for it to use instead. A missing semantic role
 * is the ROOT CAUSE of raw-palette drift, so the token layer and this test are
 * the same change.
 *
 * A kit that names `emerald` cannot be re-themed: an app that sets its own
 * tokens still gets that one hardcoded green. The same argument is why the
 * elevation scale is checked here, since `shadow-md` at a call site means the
 * shadow was picked by size rather than by what the element is.
 *
 * Comments are blanked before scanning. The classifier docs in `lib/utils.ts`
 * legitimately discuss `border-red-500/50` as an example, and prose about a
 * defect is not the defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(uiRoot, 'packages/registry');

const PALETTE_FAMILIES =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';
const RAW_PALETTE = new RegExp(
  `\\b(text|bg|border|ring|divide|outline|from|via|to)-(${PALETTE_FAMILIES})-(50|[1-9]00|950)\\b`,
  'g',
);
const RAW_SHADOW = /\bshadow-(2xs|xs|sm|md|lg|xl|2xl|inner)\b/g;

/** Blank comment bodies, preserving offsets so a reported line stays true. */
function blankComments(text) {
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const two = text.slice(i, i + 2);
    if (two === '//' && text[i - 1] !== ':') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? chars.length : end + 2;
      for (let j = i; j < stop; j += 1) if (chars[j] !== '\n') chars[j] = ' ';
      i = stop;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|js)$/.test(entry)) out.push(path);
  }
  return out;
}

function hits(re) {
  const found = [];
  for (const path of sourceFiles(REGISTRY)) {
    const raw = readFileSync(path, 'utf8');
    const text = blankComments(raw);
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length;
      found.push(`${relative(uiRoot, path)}:${line}  ${m[0]}`);
    }
  }
  return found;
}

test('the registry names no Tailwind palette family', () => {
  const found = hits(RAW_PALETTE);
  assert.deepEqual(
    found,
    [],
    `raw palette utilities in the kit's own source, use a semantic token instead:\n${found.join('\n')}`,
  );
});

test('the registry uses role-named elevation, not the size scale', () => {
  const found = hits(RAW_SHADOW);
  assert.deepEqual(
    found,
    [],
    `raw shadow sizes in the kit's own source, use shadow-e1 through shadow-e4:\n${found.join('\n')}`,
  );
});

test('every semantic role token is declared in both themes and mapped', () => {
  const css = readFileSync(join(REGISTRY, 'themes/index.css'), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
  const dark = css.slice(css.indexOf('.dark {'));
  const mapping = css.slice(css.indexOf('@theme inline {'), css.indexOf('/* Custom variants'));

  for (const role of ['success', 'warning', 'info', 'destructive']) {
    for (const suffix of ['', '-foreground', '-subtle', '-subtle-foreground']) {
      const token = `--${role}${suffix}`;
      assert.ok(root.includes(`${token}:`), `${token} is missing from :root`);
      assert.ok(dark.includes(`${token}:`), `${token} is missing from .dark`);
      // A token with no @theme inline entry emits no utility at all, so the
      // value block alone is not enough to make `text-success` exist.
      assert.ok(mapping.includes(`--color-${role}${suffix}:`), `--color-${role}${suffix} is not mapped`);
    }
  }
});

test('elevation shadows carry their colour as a var so dark can retheme them', () => {
  const css = readFileSync(join(REGISTRY, 'themes/index.css'), 'utf8');
  for (const level of ['e1', 'e2', 'e3', 'e4']) {
    const decl = css.match(new RegExp(`--shadow-${level}:[^;]+;`));
    assert.ok(decl, `--shadow-${level} is not declared`);
    // Tailwind INLINES a --shadow-* value into the utility, so a literal colour
    // here could never be rethemed under .dark and the dark inversion would
    // silently do nothing.
    assert.ok(
      decl[0].includes('var(--elevation-ambient)') && decl[0].includes('var(--elevation-contact)'),
      `--shadow-${level} must take its colour from the elevation vars, got: ${decl[0]}`,
    );
    assert.ok(!/rgb\(|oklch\(|#[0-9a-f]{3}/i.test(decl[0]), `--shadow-${level} carries a literal colour`);
  }
  for (const block of [':root', '.dark']) {
    const start = css.indexOf(`${block} {`);
    const section = css.slice(start, css.indexOf('}', start));
    assert.ok(section.includes('--elevation-ambient:'), `--elevation-ambient is missing from ${block}`);
    assert.ok(section.includes('--elevation-contact:'), `--elevation-contact is missing from ${block}`);
  }
});

test('a diluted destructive fill keeps its own foreground (#1116)', () => {
  // `--destructive-foreground` is built for a SOLID `--destructive` fill, where
  // the dark value (red-950) measures 5.58:1. `button.ts` and `badge.ts` both
  // paint `dark:bg-destructive/60`, a composite rather than a solid, against
  // which that token measures 2.49:1 and plain white measures 6.48:1.
  //
  // So the token is exactly wrong on the two components it looks most correct
  // on, and an earlier revision of this branch shipped that regression by
  // "fixing" button.ts to use it. The two must also agree with each other.
  for (const file of ['button.ts', 'badge.ts']) {
    const src = readFileSync(join(REGISTRY, 'components', file), 'utf8');
    const destructive = src.split('\n').find((l) => /destructive:/.test(l) && /bg-destructive/.test(l))
      ?? src.split('\n').find((l) => /bg-destructive\b/.test(l) && /text-/.test(l));
    assert.ok(destructive, `${file}: could not find the destructive variant`);
    assert.match(
      destructive,
      /text-white/,
      `${file}: a variant diluting the fill with bg-destructive/60 must keep text-white, since --destructive-foreground is built for the solid fill`,
    );
    assert.doesNotMatch(
      destructive,
      /text-destructive-foreground/,
      `${file}: --destructive-foreground measures 2.49:1 on the /60 composite this variant paints`,
    );
  }
});
