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

/**
 * The general rule, swept across every stylesheet and every page/layout that
 * writes CSS. The two palettes above are the ones that were duplicated worst,
 * but they were not the only ones: the syntax-highlight classes in input.css
 * and the home page's code-sample tokens each carried the same pair of
 * verbatim dark blocks. A per-file assertion would have kept missing them, so
 * this asserts the rule itself.
 */
test('no colour is declared under a per-theme selector anywhere', () => {
  // modules/ is deliberately absent: its only subtree is the gitignored
  // modules/ui/components/ mirror of the @webjsdev/ui registry, which is the
  // kit's code rather than this site's, and modules/ui/utils holds no CSS.
  // Add it here the moment a feature module starts writing styles.
  const files = [
    'public/input.css',
    ...['app', 'lib', 'components'].flatMap(function walk(dir: string): string[] {
      const abs = resolve(ROOT, dir);
      if (!existsSync(abs)) return [];
      return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : [],
      );
    }),
  ];

  // Only these three NON-colour tokens may sit under a theme selector. Every
  // colour belongs in a light-dark() pair instead.
  const ALLOWED = new Set(['--glow-strength', '--cta-mix', '--shadow-spread']);
  const offenders: string[] = [];

  for (const rel of files) {
    // Comments are stripped so prose naming a selector is not read as a rule,
    // and `pre` blocks in the docs pages are left alone: those are code
    // SAMPLES teaching the reader, not this site's own styling.
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<pre[\s\S]*?<\/pre>/g, '');
    // Terminate on the first closing brace, NOT on one at the start of a line:
    // a single-line rule (`:root[data-theme='dark'] .t-str { color: ... }`) is
    // the exact shape the highlight classes used, and anchoring to a newline
    // walked straight past it.
    const re = /(?:@media\s*\(prefers-color-scheme:\s*dark\)|\[data-theme=['"]dark['"]\])([\s\S]{0,900}?)\}/g;
    for (const m of src.matchAll(re)) {
      for (const d of m[1].matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
        if (ALLOWED.has(d[1])) continue;
        offenders.push(`${rel}: ${d[1]}`);
      }
      // A bare colour on a class inside a theme block (the .t-* highlight
      // shape) has no custom property to catch, so look for it directly.
      for (const d of m[1].matchAll(/\bcolor:\s*(oklch|#|rgb|hsl)/g)) {
        offenders.push(`${rel}: a bare ${d[1]} colour`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these belong in a light-dark(LIGHT, DARK) pair, not under a per-theme selector',
  );
});
