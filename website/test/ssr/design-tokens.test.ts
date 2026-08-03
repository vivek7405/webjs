/**
 * Pins lib/design/tokens.ts to the custom properties app/layout.ts actually
 * declares. The brand page paints its palette chips straight from tokens.ts,
 * beside real components painted from the layout's tokens, so any divergence
 * between the two files is a live visual defect on /brand: two different
 * colours presented as the same token. Review round 1 found exactly that
 * (three drifted ACCENTS values); this test is what makes the next drift a
 * red build instead of a silent lie.
 *
 * It ALSO pins the shape the layout declares them in. Each per-theme colour is
 * one light-dark(LIGHT, DARK) declaration, which is the rule the framework
 * teaches its own users (the skill's references/styling.md) and which the site
 * itself did not follow until #1216: the dark half used to be written twice,
 * once under the OS media query and once under the toggle's attribute, so an
 * edit to either copy drifted the two paths apart with nothing to catch it.
 * Both halves of this file matter, since a duplicated block would still let
 * the value assertions below pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWATCHES, ACCENTS } from '#lib/design/tokens.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const layout = readFileSync(resolve(ROOT, 'app/layout.ts'), 'utf8');

/** The one `:root { ... }` block that declares the palette. */
const rootBlock = layout.slice(layout.indexOf(':root {'), layout.indexOf('@media (prefers-color-scheme: dark)'));

/**
 * Extract `--name: light-dark(LIGHT, DARK);` pairs. The split is on the comma
 * at paren depth 0, because both sides are themselves function calls carrying
 * commas of their own (`oklch(...)`, `color-mix(...)`).
 */
function themePairs(block: string): Map<string, { light: string; dark: string }> {
  const map = new Map<string, { light: string; dark: string }>();
  for (const m of block.matchAll(/(--[a-z-]+):\s*light-dark\(([\s\S]*?)\);/g)) {
    const inner = m[2];
    let depth = 0;
    let split = -1;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') depth++;
      else if (inner[i] === ')') depth--;
      else if (inner[i] === ',' && depth === 0) { split = i; break; }
    }
    if (split === -1) continue;
    if (!map.has(m[1])) {
      map.set(m[1], { light: inner.slice(0, split).trim(), dark: inner.slice(split + 1).trim() });
    }
  }
  return map;
}

const pairs = themePairs(rootBlock);

for (const entry of [...SWATCHES, ...ACCENTS]) {
  test(`${entry.token} matches app/layout.ts in both themes`, () => {
    const pair = pairs.get(entry.token);
    assert.ok(pair, `${entry.token} is not declared as a light-dark() pair in the layout's :root block`);
    assert.equal(entry.light, pair.light, `${entry.token} (light) drifted from layout.ts`);
    assert.equal(entry.dark, pair.dark, `${entry.token} (dark) drifted from layout.ts`);
  });
}

test('the layout declares its palette once, not as duplicated dark blocks', () => {
  // Only the non-colour overrides may sit under a theme selector. Both blocks
  // are single-line, so a colour creeping back in shows up here as a
  // light-dark()-free `--token: <colour>` on the same line.
  const overrides = [...layout.matchAll(/:root(?::not\(\[data-theme='light'\]\)|\[data-theme='dark'\])\s*\{([^}]*)\}/g)]
    .map((m) => m[1])
    .join('\n');
  const declared = [...overrides.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(declared)].sort(),
    ['--cta-mix', '--glow-strength', '--shadow-spread'],
    'only NON-colour tokens may keep a per-theme override; a colour belongs in a light-dark() pair on :root',
  );
});

test('every theme state is reachable from color-scheme alone', () => {
  // light-dark() resolves off the used value of color-scheme, so these three
  // declarations are the entire theme mechanism. Losing one silently pins the
  // whole palette to one side.
  assert.match(rootBlock, /color-scheme:\s*light dark;/, 'the default (follow the OS) scheme is missing');
  assert.match(layout, /:root\[data-theme='dark'\]\s*\{\s*color-scheme:\s*dark;\s*\}/, "the toggle's forced-dark scheme is missing");
  assert.match(layout, /:root\[data-theme='light'\]\s*\{\s*color-scheme:\s*light;\s*\}/, "the toggle's forced-light scheme is missing");
});
