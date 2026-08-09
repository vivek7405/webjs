import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasModuleScopeSideEffect } from '../../server/src/component-elision.js';

// Guards the #819 split: importing `cn` must NOT pin a page to the browser, so
// the registry `lib/utils.ts` (copied to a scaffold's `lib/utils/cn.ts`) must
// stay pure. Any client global (`document`, `HTMLElement`, `customElements`,
// `window`) in that file marks it client-effecting and re-pins every importer.
// The one client helper, `onBeforeCache`, lives in `lib/dom.ts` instead.

const REG = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'registry');

/** Remove line + block comments so we only test real code tokens. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('registry lib/utils.ts is pure (no client globals, so cn() does not pin a page) (#819)', () => {
  const code = stripComments(readFileSync(join(REG, 'lib', 'utils.ts'), 'utf8'));
  for (const g of ['document', 'HTMLElement', 'customElements', 'window', 'defineElement', 'ServerHTMLElementStub']) {
    assert.ok(!new RegExp(`\\b${g}\\b`).test(code), `utils.ts must not reference the client global \`${g}\` (it would pin every page importing cn)`);
  }
  assert.ok(/export function cn\b/.test(code), 'utils.ts still exports cn');
});

test('registry lib/dom.ts holds onBeforeCache (the client-only helper) (#819)', () => {
  const dom = join(REG, 'lib', 'dom.ts');
  assert.ok(existsSync(dom), 'lib/dom.ts exists');
  assert.ok(/export function onBeforeCache\b/.test(readFileSync(dom, 'utf8')), 'dom.ts exports onBeforeCache');
});

test('no registry component imports onBeforeCache from ../lib/utils.ts (#819)', () => {
  const dir = join(REG, 'components');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.ok(
      !/import\s*\{[^}]*\bonBeforeCache\b[^}]*\}\s*from\s*['"]\.\.\/lib\/utils\.ts['"]/.test(src),
      `${f} must import onBeforeCache from ../lib/dom.ts, not ../lib/utils.ts`,
    );
  }
});

// A registry module must do NO work at module scope: not a call, not a `new`,
// not a `document` reference. The elision analyser reads any of those as client
// work, so the module pins every page reaching it on a component-free path, and
// a Tier-1 helper registers no element, so the path-aware carve-out (#963)
// cannot save it. Measured: a synthetic app went from 2 of 3 route modules
// shipping whole to 0 once `lib/utils.ts` and `native-select.ts` were cleaned
// (#1320). Calling the framework's own predicate rather than re-implementing
// its depth-0 scan is deliberate: a copy would drift the moment the analyser
// changes, and then this guard would be asserting a rule nothing enforces.
//
// This list may only SHRINK. Every entry names why it is still on it.
const KNOWN_FLAGGED = [
  // ANALYSER PRECISION GAP, not module-scope work. An arrow function with an
  // EXPRESSION body puts its call at brace depth 0, so `export const f = ():
  // string => cn(...)` reads to the predicate as a top-level call. Fixing that
  // means either teaching the analyser about arrow bodies or wrapping pure
  // helpers in braces to dodge a scanner limitation. Neither is #1320's job.
  'components/pagination.ts', // `=> cn(buttonClass(...))`
  'components/progress.ts', // `=> [ ... ].join(' ')`
  'components/sonner.ts', // `=> makeToast(...)`
  'components/tabs.ts', // `=> s.replace(...)`
  // REAL module-scope style injection, the same defect #1320 fixed in
  // native-select. NOT moved with it, because their injected CSS is the ONLY
  // source of the checkmark and the radio dot, `ensureTheme` never rewrites an
  // existing theme block, and an already-initialised app would therefore lose
  // the indicator entirely (a WCAG 1.4.1 failure, not a cosmetic one). Moving
  // these needs a theme-block upgrade path in `ensureTheme` first. Native
  // select's equivalent gap only degrades <option> legibility back to the
  // browser default, which is why it could move and these cannot.
  'components/checkbox.ts', // `if (typeof document !== 'undefined') installCheckboxStyles();`
  'components/radio-group.ts', // `if (typeof document !== 'undefined') installRadioStyles();`
].sort();

test('registry modules do no module-scope work (#1320)', () => {
  const flagged = [];
  for (const sub of ['lib', 'components']) {
    for (const name of readdirSync(join(REG, sub)).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(REG, sub, name), 'utf8');
      if (hasModuleScopeSideEffect(src)) flagged.push(`${sub}/${name}`);
    }
  }
  // Pinned-set EQUALITY, not a subset: a new module doing module-scope work
  // fails immediately, and removing an entry without editing this list fails
  // too, so the list can only ever shrink deliberately.
  assert.deepEqual(flagged.sort(), KNOWN_FLAGGED);
});

test('lib/utils.ts and native-select.ts do no module-scope work (#1320)', () => {
  for (const rel of ['lib/utils.ts', 'components/native-select.ts']) {
    assert.equal(hasModuleScopeSideEffect(readFileSync(join(REG, rel), 'utf8')), false, rel);
  }
});

test('native-select injects no stylesheet (#1320)', () => {
  const code = stripComments(readFileSync(join(REG, 'components', 'native-select.ts'), 'utf8'));
  assert.ok(!/\bdocument\b/.test(code), 'native-select.ts must not reference document');
  assert.ok(!/installNativeSelectStyles/.test(code), 'the injector is gone');
});
