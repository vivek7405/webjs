/**
 * Pins lib/design/tokens.ts to the custom properties app/layout.ts actually
 * declares. The brand page paints its palette chips straight from tokens.ts,
 * beside real components painted from the layout's tokens, so any divergence
 * between the two files is a live visual defect on /brand: two different
 * colours presented as the same token. Review round 1 found exactly that
 * (three drifted ACCENTS values); this test is what makes the next drift a
 * red build instead of a silent lie.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWATCHES, ACCENTS } from '#lib/design/tokens.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const layout = readFileSync(resolve(ROOT, 'app/layout.ts'), 'utf8');

/** Extract `--name: value;` pairs from one CSS block of layout.ts. */
function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2].trim());
  }
  return map;
}

// The light theme is the bare `:root { ... }` block; dark is the explicit
// `:root[data-theme='dark']` block (the media-query copy mirrors it).
const rootBlock = layout.slice(layout.indexOf(':root {'), layout.indexOf('@media (prefers-color-scheme: dark)'));
const darkStart = layout.indexOf(":root[data-theme='dark']");
const darkBlock = layout.slice(darkStart, layout.indexOf('}', layout.indexOf('--shadow:', darkStart)));
const light = declarations(rootBlock);
const dark = declarations(darkBlock);

for (const entry of [...SWATCHES, ...ACCENTS]) {
  test(`${entry.token} matches app/layout.ts in both themes`, () => {
    assert.equal(entry.light, light.get(entry.token), `${entry.token} (light) drifted from layout.ts`);
    assert.equal(entry.dark, dark.get(entry.token), `${entry.token} (dark) drifted from layout.ts`);
  });
}
