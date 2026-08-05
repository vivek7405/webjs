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

test('cn: every display keyword shares one group, so a repeated one collapses', () => {
  // Splitting the flex/grid sub-properties out must not leave a bare display
  // value ungrouped: an identical repeated token has always collapsed, and
  // `fieldRowClass()` already returns `flex items-center gap-3`, so a caller
  // adding its own `flex` would otherwise emit it twice.
  assert.equal(cn('flex', 'flex'), 'flex');
  assert.equal(cn('grid', 'grid'), 'grid');
  assert.equal(cn('flex items-center gap-3', 'flex'), 'items-center gap-3 flex');
  // display is ONE property, so the keywords resolve against each other.
  assert.equal(cn('hidden', 'flex'), 'flex');
  assert.equal(cn('block', 'inline-flex'), 'inline-flex');
  assert.equal(cn('table', 'table-cell'), 'table-cell');
  // Still not a member of the sub-property groups.
  assert.equal(cn('flex', 'flex-1'), 'flex flex-1');
});

test('cn: an arbitrary value may contain a colon without losing its group', () => {
  // variantPrefix() splits on the last colon OUTSIDE brackets. Splitting on the
  // last colon anywhere hands the matcher a fragment like `2px]`, which matches
  // nothing, so the utility silently stops deduping against its own property.
  assert.equal(cn('border-[length:2px]', 'border-4'), 'border-4');
  assert.equal(cn('border-2', 'border-[length:var(--w)]'), 'border-[length:var(--w)]');
  assert.equal(cn('border-[length:2px]', 'border-primary'), 'border-[length:2px] border-primary');
  // A real variant prefix still splits, including a stacked one and one whose
  // own arbitrary value carries a colon.
  assert.equal(cn('hover:flex', 'flex'), 'hover:flex flex');
  assert.equal(cn('md:hover:bg-red-500', 'md:hover:bg-blue-500'), 'md:hover:bg-blue-500');
  assert.equal(cn('supports-[display:grid]:flex', 'flex'), 'supports-[display:grid]:flex flex');
  assert.equal(
    cn('[&:hover]:bg-[url(https://x/y.png)]', '[&:hover]:bg-primary'),
    '[&:hover]:bg-[url(https://x/y.png)] [&:hover]:bg-primary',
  );
});

test('cn: an arbitrary value type hint names the property, so it picks the group', () => {
  // Once a bracketed value reaches the matcher, the prefix alone is not enough
  // to say which property it sets: `text-[length:14px]` is a font SIZE, not a
  // colour, and `bg-[url(...)]` is an image, not a background colour. Routing
  // by prefix would collapse a size against a colour, which is the exact
  // regression the text-size / text-color split at the top of the file exists
  // to prevent.
  assert.equal(cn('text-[length:14px]', 'text-primary'), 'text-[length:14px] text-primary');
  assert.equal(cn('text-[length:14px]', 'text-sm'), 'text-sm');
  assert.equal(cn('bg-[url(https://a.b/c.png)]', 'bg-primary'), 'bg-[url(https://a.b/c.png)] bg-primary');
  assert.equal(cn('bg-[url(/a.png)]', 'bg-none'), 'bg-none');
  assert.equal(cn('bg-[image:var(--g)]', 'bg-primary'), 'bg-[image:var(--g)] bg-primary');
  assert.equal(cn('bg-[position:center]', 'bg-center'), 'bg-center');
  assert.equal(cn('bg-[size:cover]', 'bg-cover'), 'bg-cover');
  // A hint that DOES name the prefix's default property still collapses.
  assert.equal(cn('bg-[color:var(--c)]', 'bg-primary'), 'bg-primary');
  assert.equal(cn('text-[color:var(--c)]', 'text-primary'), 'text-primary');
  // An unmapped hint stays ungrouped and survives: an extra class renders, a
  // dropped one does not, so that is the safe direction to fail. This holds for
  // EVERY prefix, not the ones that happened to get a bespoke pattern: handling
  // only bg- and text- left `shadow-[color:red]` evicting `shadow-lg`.
  assert.equal(cn('text-[family-name:Inter]', 'text-primary'), 'text-[family-name:Inter] text-primary');
  assert.equal(cn('bg-[angle:45deg]', 'bg-primary'), 'bg-[angle:45deg] bg-primary');
  assert.equal(cn('shadow-lg', 'shadow-[color:red]'), 'shadow-lg shadow-[color:red]');
  assert.equal(cn('shadow-[0_0_10px_red]', 'shadow-[color:red]'), 'shadow-[0_0_10px_red] shadow-[color:red]');
  assert.equal(cn('text-primary', 'text-shadow-[color:red]'), 'text-primary text-shadow-[color:red]');
  assert.equal(cn('border-[angle:45deg]', 'border-primary'), 'border-[angle:45deg] border-primary');
  assert.equal(cn('p-[length:4px]', 'p-2'), 'p-[length:4px] p-2');
  // Ungrouped is not the same as never deduping: the identical hint under the
  // identical prefix is still one property, and still collapses.
  assert.equal(cn('shadow-[color:red]', 'shadow-[color:blue]'), 'shadow-[color:blue]');
  assert.equal(cn('p-[length:4px]', 'p-[length:8px]'), 'p-[length:8px]');
  assert.equal(cn('hover:shadow-[color:red]', 'shadow-[color:blue]'), 'hover:shadow-[color:red] shadow-[color:blue]');
  // A per-side border hint still routes through the border value parser, for
  // EVERY side the parser enumerates. The logical inline sides are the ones a
  // hand-written side list forgets, and then the hinted and plain spellings of
  // one utility land in different groups.
  assert.equal(cn('border-t-[color:var(--c)]', 'border-t-primary'), 'border-t-primary');
  assert.equal(cn('border-s-primary', 'border-s-[color:red]'), 'border-s-[color:red]');
  assert.equal(cn('border-e-primary', 'border-e-[color:red]'), 'border-e-[color:red]');
  assert.equal(cn('border-s-2', 'border-s-[length:4px]'), 'border-s-[length:4px]');
  assert.equal(cn('border-s-[length:4px]', 'border-4'), 'border-4');
  // A bracketed value with no hint keeps the prefix's default property.
  assert.equal(cn('bg-[#fff]', 'bg-primary'), 'bg-primary');
  assert.equal(cn('bg-[var(--x)]', 'bg-primary'), 'bg-primary');
  assert.equal(cn('text-[#fff]', 'text-primary'), 'text-primary');
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
