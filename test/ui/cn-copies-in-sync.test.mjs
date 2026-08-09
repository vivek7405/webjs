/**
 * The `cn()` class merger exists in two hand-synced source copies:
 *
 *   packages/ui/packages/registry/lib/utils.ts   the canonical one, which every
 *                                                generated copy derives from
 *   examples/blog/lib/utils/cn.ts                the blog dogfood app's copy
 *
 * Nothing mechanically links them, so a conflict-group fix landed in one and
 * forgotten in the other drifts silently: the registry tests keep passing while
 * the blog renders with the old, wrong merge. This test pins the two together
 * behaviourally, which is the property that actually matters (the files carry
 * different surrounding comments and different helper exports, so a byte
 * comparison of the whole file would be noise).
 *
 * TWO is the whole inventory of hand-synced SOURCES, and it is the reason this
 * guard loads exactly two files. Other `cn.ts` files exist on disk and are
 * GENERATED from the registry copy (`website/lib/utils/cn.ts` via
 * `website/scripts/copy-registry.mjs`, gitignored; an app's copy via
 * `webjs create` / `webjsui init` / `webjsui add`). They need no guard and must
 * not be hand-edited: a stale one is a generator that has not been re-run,
 * which is not drift. See the registry-resolution section of
 * `packages/ui/AGENTS.md` for which sources each generator reads.
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
import { stripTypeScript } from '../../packages/server/src/ts-strip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadCn(relPath) {
  const js = await stripTypeScript(readFileSync(join(root, relPath), 'utf8'));
  const file = join(mkdtempSync(join(tmpdir(), 'webjs-cn-sync-')), 'utils.mjs');
  writeFileSync(file, js);
  return (await import(pathToFileURL(file).href)).cn;
}

const registryCn = await loadCn('packages/ui/packages/registry/lib/utils.ts');
const blogCn = await loadCn('examples/blog/lib/utils/cn.ts');

// One token per conflict group the merger knows about, plus the shapes whose
// classification is easy to get wrong (border width vs colour vs style, the
// bare flex/grid display values, arbitrary and opacity forms, variants).
const TOKENS = [
  'p-2', 'px-4', 'py-2', 'pl-1', 'm-0', 'mx-4', 'mt-2',
  'w-8', 'h-9', 'size-4',
  'bg-primary', 'bg-cover', 'bg-none', 'bg-repeat-x',
  'text-sm', 'text-primary', 'text-center',
  'border', 'border-2', 'border-[3px]', 'border-t', 'border-t-4', 'border-x-2',
  'border-s-2', 'border-e-4',
  'border-[length:2px]', 'border-[length:var(--w)]',
  'border-primary', 'border-border', 'border-accent', 'border-red-500/50',
  'border-[#fff]', 'border-t-primary', 'border-x-accent',
  'bg-[url(https://a.b/c.png)]', 'bg-[image:var(--g)]', 'bg-[position:center]',
  'bg-[size:cover]', 'bg-[color:var(--c)]', 'bg-[angle:45deg]', 'bg-[#fff]',
  'text-[color:var(--c)]', 'text-[length:14px]', 'text-[family-name:Inter]',
  'supports-[display:grid]:flex', '[&:hover]:bg-primary',
  'border-solid', 'border-dashed', 'border-collapse', 'border-spacing-2',
  'rounded', 'rounded-full', 'opacity-50', 'font-medium', 'shadow-sm', 'z-10',
  'shadow-lg', 'shadow-[color:red]', 'shadow-[0_0_10px_red]',
  'text-shadow-[color:red]', 'p-[length:4px]', 'border-[angle:45deg]',
  'border-s-[color:red]', 'border-e-[length:4px]',
  'flex', 'flex-1', 'flex-auto', 'flex-[2]', 'flex-row', 'flex-col',
  'flex-wrap', 'flex-nowrap',
  'grid', 'grid-cols-2', 'grid-rows-3', 'grid-flow-col',
  'block', 'hidden', 'inline-flex', 'items-center', 'gap-3', 'basis-full',
  'hover:border-primary', 'dark:bg-primary', 'md:flex-1',
  // The background, box-shadow and text-shadow sub-properties that used to be
  // keyed by prefix rather than by property (#1265).
  'bg-clip-text', 'bg-clip-border', 'bg-origin-border', 'bg-blend-multiply',
  'bg-top-left', 'bg-size-[auto_100px]', 'bg-position-[center_top]', 'bg-fixed',
  'text-left', 'text-nowrap', 'text-ellipsis',
  'shadow', 'shadow-none', 'shadow-inner', 'shadow-lg/25', 'shadow-red-500',
  'shadow-red-500/50', 'shadow-inherit', 'shadow-[#fff]',
  'shadow-[var(--shadow-glow)]', 'shadow-(--shadow-glow)', 'text-shadow-[var(--x)]',
  'shadow-(color:--x)', 'bg-(image:--g)', 'bg-(color:--c)', 'bg-(size:--s)',
  'text-(length:--s)', 'text-(color:--c)', 'text-shadow-(color:--x)',
  'border-(length:--w)', 'border-(color:--c)', 'border-t-(length:--w)',
  'border-(--x)', 'hover:shadow-(color:--x)', 'supports-(--foo):flex',
  'text-shadow-lg', 'text-shadow-none', 'text-shadow-red-500',
];

test('cn: the registry and blog copies merge every pair identically', () => {
  const mismatches = [];
  for (const a of TOKENS) {
    for (const b of TOKENS) {
      const fromRegistry = registryCn(a, b);
      const fromBlog = blogCn(a, b);
      if (fromRegistry !== fromBlog) {
        mismatches.push(`cn('${a}', '${b}'): registry ${JSON.stringify(fromRegistry)} vs blog ${JSON.stringify(fromBlog)}`);
      }
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    `examples/blog/lib/utils/cn.ts has drifted from the canonical registry copy.\n${mismatches.join('\n')}`,
  );
});

test('cn: the blog copy carries the conflict-group fixes (#1065, #1072, #1265, #1338)', () => {
  // A drift guard alone would stay green if BOTH copies regressed together, so
  // assert the headline behaviour directly on the blog copy too.
  assert.equal(blogCn('flex', 'flex-1'), 'flex flex-1');
  assert.equal(blogCn('grid', 'grid-cols-2'), 'grid grid-cols-2');
  assert.equal(blogCn('border-border', 'border-accent'), 'border-accent');
  assert.equal(blogCn('border-2', 'border-primary'), 'border-2 border-primary');
  assert.equal(blogCn('flex', 'flex'), 'flex');
  assert.equal(blogCn('border-[length:2px]', 'border-4'), 'border-4');
  assert.equal(blogCn('shadow-lg', 'shadow-[color:red]'), 'shadow-lg shadow-[color:red]');
  assert.equal(blogCn('bg-clip-text', 'bg-primary'), 'bg-clip-text bg-primary');
  assert.equal(blogCn('bg-origin-border', 'bg-primary'), 'bg-origin-border bg-primary');
  assert.equal(blogCn('bg-blend-multiply', 'bg-primary'), 'bg-blend-multiply bg-primary');
  assert.equal(blogCn('shadow-lg', 'shadow-red-500'), 'shadow-lg shadow-red-500');
  assert.equal(blogCn('shadow-red-500', 'shadow-lg'), 'shadow-red-500 shadow-lg');
  assert.equal(blogCn('text-primary', 'text-shadow-lg'), 'text-primary text-shadow-lg');
  assert.equal(blogCn('text-shadow-sm', 'text-primary'), 'text-shadow-sm text-primary');
  assert.equal(blogCn('text-left', 'text-center'), 'text-center');
  assert.equal(blogCn('text-ellipsis', 'text-clip'), 'text-clip');
  assert.equal(blogCn('bg-(image:--g)', 'bg-primary'), 'bg-(image:--g) bg-primary');
  assert.equal(blogCn('bg-(image:--g)', 'bg-(image:--h)'), 'bg-(image:--h)');
  assert.equal(blogCn('shadow-(color:--x)', 'shadow-lg'), 'shadow-(color:--x) shadow-lg');
  assert.equal(blogCn('border-(length:--w)', 'border-primary'), 'border-(length:--w) border-primary');
});
