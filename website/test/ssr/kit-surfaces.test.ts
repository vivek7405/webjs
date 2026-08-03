/**
 * Two surfaces this site shares with a scaffolded app, both of which drifted
 * before #1216 with nothing to catch either one.
 *
 * 1. components/ui/ belongs to `webjs ui add`, exactly as it does in a real
 *    app, so this site tracks nothing there. Eleven byte-identical copies of
 *    the generated modules/ui/components/ mirror were committed into it by
 *    accident and sat unimported until someone read the directory.
 * 2. The .ui-preview palette in public/input.css declares each kit colour once
 *    via light-dark(), rather than as a light block plus two dark blocks
 *    saying the same thing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('components/ui/ is left empty for webjs ui add', () => {
  const dir = resolve(ROOT, 'components/ui');
  const entries = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  assert.deepEqual(
    entries,
    [],
    'components/ui/ is reserved for `webjs ui add`; the gallery previews import from modules/ui/components/ instead',
  );
});

// Comments are stripped first, so a selector named in explanatory prose is not
// mistaken for a live rule (the comment above .ui-preview names data-theme to
// explain why the block does NOT use it).
const inputCss = readFileSync(resolve(ROOT, 'public/input.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const previewBlock = inputCss.slice(inputCss.indexOf('.ui-preview {'), inputCss.indexOf('}', inputCss.indexOf('.ui-preview {')));

test('the .ui-preview palette declares each colour once via light-dark()', () => {
  const declared = [...previewBlock.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]);
  const paired = [...previewBlock.matchAll(/(--[a-z-]+):\s*light-dark\(/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, 'the .ui-preview block was not found in public/input.css');
  assert.deepEqual(
    declared.filter((t) => !paired.includes(t)),
    [],
    'every .ui-preview token is a per-theme colour, so each one takes a light-dark() pair',
  );
});

test('.ui-preview keeps no duplicate dark block', () => {
  // color-scheme inherits from the root, so the container needs no theme
  // selector of its own. One reintroduced here is the duplication that
  // light-dark() replaced.
  assert.equal(
    /(?:prefers-color-scheme|data-theme)[^{]*\.ui-preview\s*\{/.test(inputCss),
    false,
    '.ui-preview resolves its theme through inherited color-scheme, not a per-theme selector',
  );
});
