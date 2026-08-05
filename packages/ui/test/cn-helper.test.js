/**
 * Tests for the hand-rolled `cn()` helper that lives in
 * `packages/registry/lib/utils.ts`. We exercise the dedupe groups that
 * components actually rely on: specifically the `text-size` vs `text-color`
 * split that regressed once when both buckets were collapsed into a single
 * `text-` group (text-sm got eaten by text-primary-foreground).
 *
 * The helper is shipped to user projects verbatim. To run it in the plain
 * Node test runner we strip its TypeScript types via Node 24+'s built-in
 * `module.stripTypeScriptTypes` (the same primitive `webjs dev` uses) and
 * import the resulting JS module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Framework's runtime-portable stripper (built-in on Node, amaro on Bun), NOT a
// named `import { stripTypeScriptTypes } from 'node:module'` (a LINK-TIME error
// on Bun, where the export is absent).
import { stripTypeScript } from '../../server/src/ts-strip.js';

const UTILS_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'registry',
  'lib',
  'utils.ts',
);

const ts = readFileSync(UTILS_SRC, 'utf8');
const js = await stripTypeScript(ts);
const dir = mkdtempSync(join(tmpdir(), 'webjs-ui-cn-'));
const file = join(dir, 'utils.mjs');
writeFileSync(file, js);
const { cn } = await import(pathToFileURL(file).href);

test('cn: joins truthy values with spaces', () => {
  assert.equal(cn('a', 'b', 'c'), 'a b c');
  assert.equal(cn('a', false, 'b', null, 'c', undefined), 'a b c');
});

test('cn: dedupes background-color (last wins)', () => {
  assert.equal(cn('bg-red-500', 'bg-blue-500'), 'bg-blue-500');
});

test('cn: text-size and text-color are SEPARATE groups (regression: text-sm survived next to text-primary)', () => {
  const result = cn('text-sm', 'text-primary-foreground');
  assert.match(result, /text-sm/, 'text-sm must survive');
  assert.match(result, /text-primary-foreground/, 'text-primary-foreground must survive');
});

test('cn: dedupes only same group: h-9 vs h-12 (last wins) but h-9 + w-full coexist', () => {
  assert.equal(cn('h-9', 'h-12'), 'h-12');
  const out = cn('h-9', 'w-full');
  assert.match(out, /h-9/);
  assert.match(out, /w-full/);
});

test('cn: padding subgroups: px-4 + py-2 coexist; px-4 + px-6 collapses to px-6', () => {
  assert.equal(cn('px-4', 'px-6'), 'px-6');
  const out = cn('px-4', 'py-2');
  assert.match(out, /px-4/);
  assert.match(out, /py-2/);
});

test('cn: a shorthand overrides the axis/side it subsumes (the icon-button gap)', () => {
  // The bug this fixes: buttonClass() ships px-4 py-2, and cn(..., 'p-0') used to
  // keep all three (unreliable). A shorthand now wins over what it subsumes.
  assert.equal(cn('px-4', 'py-2', 'p-0'), 'p-0');
  // Directional, not symmetric: shorthand THEN axis refines (both survive);
  // axis THEN shorthand collapses to the shorthand.
  assert.equal(cn('p-4', 'px-2'), 'p-4 px-2');
  assert.equal(cn('px-2', 'p-4'), 'p-4');
  // Side vs axis: a later px removes an earlier pl/pr; a later side refines px.
  assert.equal(cn('pl-1', 'px-2'), 'px-2');
  assert.equal(cn('px-2', 'pl-1'), 'px-2 pl-1');
  // Margin behaves the same; size subsumes w and h.
  assert.equal(cn('mx-4', 'm-0'), 'm-0');
  assert.equal(cn('w-8', 'size-4'), 'size-4');
  // Conflicts stay within a variant (a hover: shorthand does not touch a base axis).
  assert.equal(cn('px-4', 'hover:p-0'), 'px-4 hover:p-0');
});

test('cn: variant prefixes (hover:, dark:) dedupe within their own variant only', () => {
  const out = cn('bg-white', 'hover:bg-blue-500', 'hover:bg-red-500');
  assert.match(out, /bg-white/);
  assert.match(out, /hover:bg-red-500/);
  assert.doesNotMatch(out, /hover:bg-blue-500/);
});

test('cn: a bare flex/grid display survives next to its sub-utilities (#1072)', () => {
  // The dogfood bug: a search form is BOTH a flex container (icon + input) and a
  // flex child of its row, so it needs `flex ... flex-1`. The old `^flex(-|$)`
  // group treated the two as one property, dropped `flex`, and the form fell
  // back to display:block with the icon stacked above a clipped input.
  assert.equal(cn('flex', 'flex-1'), 'flex flex-1');
  assert.equal(cn('grid', 'grid-cols-2'), 'grid grid-cols-2');
  // Every sub-utility is a different CSS property, so they all coexist.
  assert.equal(cn('flex', 'flex-col', 'flex-wrap', 'flex-1'), 'flex flex-col flex-wrap flex-1');
  assert.equal(cn('grid', 'grid-cols-2', 'grid-rows-3', 'grid-flow-col'), 'grid grid-cols-2 grid-rows-3 grid-flow-col');
});

test('cn: flex/grid sub-utilities still dedupe within their own property', () => {
  assert.equal(cn('flex-row', 'flex-col'), 'flex-col');
  assert.equal(cn('flex-wrap', 'flex-nowrap'), 'flex-nowrap');
  assert.equal(cn('flex-1', 'flex-auto'), 'flex-auto');
  assert.equal(cn('flex-1', 'flex-[2]'), 'flex-[2]');
  assert.equal(cn('grid-cols-2', 'grid-cols-4'), 'grid-cols-4');
  assert.equal(cn('grid-flow-row', 'grid-flow-col'), 'grid-flow-col');
});

test('cn: border width and border color are SEPARATE groups (#1065)', () => {
  // Without a border-color group, both classes were emitted and the winner was
  // decided by compiled stylesheet order (alphabetical), so an override to an
  // earlier token silently lost.
  assert.equal(cn('border-border', 'border-accent'), 'border-accent');
  assert.equal(cn('border-red-500/50', 'border-primary'), 'border-primary');
  // A width is never evicted by a color, and vice versa.
  assert.equal(cn('border-2', 'border-primary'), 'border-2 border-primary');
  assert.equal(cn('border-primary', 'border-2'), 'border-primary border-2');
  assert.equal(cn('border', 'border-primary'), 'border border-primary');
  // Arbitrary values classify by their VALUE: a length is a width, a colour is
  // a colour.
  assert.equal(cn('border-[3px]', 'border-primary'), 'border-[3px] border-primary');
  assert.equal(cn('border-2', 'border-[3px]'), 'border-[3px]');
  assert.equal(cn('border-[#fff]', 'border-primary'), 'border-primary');
  // Border style is a third property again.
  assert.equal(cn('border-solid', 'border-primary'), 'border-solid border-primary');
  assert.equal(cn('border-dashed', 'border-solid'), 'border-solid');
  assert.equal(cn('border-collapse', 'border-separate'), 'border-separate');
});

test('cn: border sides subsume like padding does', () => {
  // A later all-sides utility drops the side it subsumes; a later side only
  // refines the shorthand, so both survive.
  assert.equal(cn('border-t-4', 'border'), 'border');
  assert.equal(cn('border', 'border-t-4'), 'border border-t-4');
  assert.equal(cn('border-t-primary', 'border-primary'), 'border-primary');
  assert.equal(cn('border-primary', 'border-t-accent'), 'border-primary border-t-accent');
  assert.equal(cn('border-l-2', 'border-x-4'), 'border-x-4');
  assert.equal(cn('border-b', 'border-b-2'), 'border-b-2');
  // Logical inline sides are subsumed by the all-sides shorthand only: which
  // physical side they land on depends on the writing direction, so an x-axis
  // override there would be a guess.
  assert.equal(cn('border-s-2', 'border-4'), 'border-4');
  assert.equal(cn('border-s-2', 'border-x-4'), 'border-s-2 border-x-4');
  assert.equal(cn('border-s-2', 'border-primary'), 'border-s-2 border-primary');
  // Border conflicts stay inside their variant like every other group.
  assert.equal(cn('hover:border-border', 'hover:border-primary', 'border-2'), 'hover:border-primary border-2');
});

test('cn: rounded variants collapse to last', () => {
  assert.equal(cn('rounded-md', 'rounded-full'), 'rounded-full');
  assert.equal(cn('rounded', 'rounded-full'), 'rounded-full');
});

// The old `Base` / `defineElement` HTMLElement-era helpers were removed in #819
// (the registry components extend `WebComponent` from `@webjsdev/core` now, and
// keeping them referenced `HTMLElement` / `customElements` at module scope, which
// pinned every page importing `cn`). Their absence + cn's purity is guarded by
// `utils-purity.test.js`.
test('Base and defineElement are no longer exported (removed in #819)', async () => {
  const utils = await import(pathToFileURL(file).href);
  assert.equal(utils.Base, undefined, 'Base was removed');
  assert.equal(utils.defineElement, undefined, 'defineElement was removed');
});
