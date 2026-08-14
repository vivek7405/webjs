/**
 * The skill's intent cheat sheet and the gallery's demo index must describe the
 * same set of features.
 *
 * An agent building a WebJs app meets the gallery index first and the skill
 * second, so both have to answer "I need to do X, does WebJs have something for
 * that?". `SKILL.md`'s "Reach For The Right Primitive" table and
 * `gallery/modules/gallery/nav.ts` each carry one entry per demo, keyed the same
 * way. Nothing kept them in step, and a feature landing in one surface but not
 * the other is invisible until an agent hand-rolls a primitive that already
 * exists (#1408).
 *
 * Prose parity is deliberately NOT asserted: a card blurb is a sentence and a
 * cheat-sheet row is a clause, so forcing the strings to match would make one of
 * them bad. What is asserted is the correspondence between the SETS, plus that
 * every path a row points at actually resolves. The reference is the load-bearing
 * pointer, because `gallery:clear` deletes the demos once an app outgrows them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL_DIR = join(repoRoot, '.agents/skills/webjs');
const SKILL = join(SKILL_DIR, 'SKILL.md');
const NAV = join(repoRoot, 'gallery/modules/gallery/nav.ts');
const HEADING = '## Reach For The Right Primitive';

/**
 * The cheat-sheet rows, one per demo.
 *
 * Sliced to the section rather than scanned over the whole file, so the topic
 * routing table further down (which has its own pipe rows and no demo paths)
 * cannot be mistaken for a cheat-sheet row.
 */
function cheatSheetRows() {
  const md = readFileSync(SKILL, 'utf8');
  const start = md.indexOf(HEADING);
  assert.notEqual(start, -1, `${HEADING} is missing from SKILL.md`);
  const rest = md.slice(start + HEADING.length);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);

  return section
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[\s|:-]*\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells[0] !== 'I need to...')
    .map((cells, i) => {
      assert.equal(cells.length, 5, `cheat-sheet row ${i + 1} has ${cells.length} cells, want 5`);
      const [intent, primitive, reflex, reference, demo] = cells;
      return {
        intent,
        primitive,
        reflex,
        reference: reference.replaceAll('`', ''),
        demo: demo.replaceAll('`', ''),
      };
    });
}

/** Every demo href the gallery index lists, as the `app/...` path a row names. */
function navDemoPaths() {
  const src = readFileSync(NAV, 'utf8');
  return [...src.matchAll(/href: '\/((?:features|examples)\/[a-z0-9-]+)'/g)].map((m) => `app/${m[1]}`);
}

test('every gallery demo has exactly one cheat-sheet row', () => {
  const rows = cheatSheetRows();
  const demos = navDemoPaths();
  assert.ok(demos.length >= 20, `expected the gallery index to list its demos, found ${demos.length}`);

  const rowDemos = rows.map((r) => r.demo);
  assert.deepEqual(
    [...new Set(rowDemos)].sort(),
    rowDemos.slice().sort(),
    'a demo is named by more than one cheat-sheet row',
  );
  assert.deepEqual(
    rowDemos.slice().sort(),
    demos.slice().sort(),
    'the cheat sheet and the gallery index list different demos',
  );
});

test('every cheat-sheet row points at paths that exist', () => {
  for (const row of cheatSheetRows()) {
    // The reference is the half that survives `gallery:clear`, so a row without
    // a resolvable one is a row that goes dead the moment an app prunes the
    // gallery.
    assert.match(row.reference, /^references\/[a-z-]+\.md$/, `row "${row.intent}" names no reference file`);
    assert.ok(
      existsSync(join(SKILL_DIR, row.reference)),
      `row "${row.intent}" points at ${row.reference}, which does not exist`,
    );
    assert.ok(
      existsSync(join(repoRoot, 'gallery', row.demo)),
      `row "${row.intent}" points at ${row.demo}, which does not exist in the gallery`,
    );
  }
});

test('every cheat-sheet row names a primitive and the reflex it replaces', () => {
  // The reflex column is what makes a row fire for an agent that is already
  // reaching for the React-shaped version. A row missing it is a row that only
  // helps someone who was looking for the feature by name.
  for (const row of cheatSheetRows()) {
    assert.ok(row.intent.length > 0, 'a cheat-sheet row has an empty intent');
    assert.ok(row.primitive.length > 0, `row "${row.intent}" names no primitive`);
    assert.ok(row.reflex.length > 0, `row "${row.intent}" names no reflex to resist`);
  }
});
