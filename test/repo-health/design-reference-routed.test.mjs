/**
 * The design reference exists AND is routed (#1116).
 *
 * An unrouted reference is a file no agent opens. The skill tells an agent to
 * classify the task and load the smallest useful reference set from the topic
 * table, so a file missing from that table is invisible however good it is,
 * and the gate would then be measuring the routing rather than the content.
 *
 * Both tables are checked because they are NOT the same table: `SKILL.md`
 * routes topic-then-reference and root `AGENTS.md` routes reference-then-topic,
 * so a row added to one is genuinely absent from the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL_DIR = join(repoRoot, '.agents/skills/webjs');
const REFERENCES = ['design.md', 'design-depth.md'];

for (const file of REFERENCES) {
  test(`${file} exists in the canonical skill`, () => {
    const path = join(SKILL_DIR, 'references', file);
    assert.ok(existsSync(path), `${path} is missing`);
    // The scaffold bundles the canonical copy at prepack rather than keeping a
    // second one, so this path is also what a generated app receives.
    assert.ok(readFileSync(path, 'utf8').length > 1000, `${file} is a stub`);
  });

  test(`${file} is routed from SKILL.md`, () => {
    const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    assert.ok(skill.includes(`references/${file}`), `SKILL.md does not route references/${file}`);
  });

  test(`${file} is routed from root AGENTS.md`, () => {
    const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes(`references/${file}`), `AGENTS.md does not route references/${file}`);
  });
}

test('styling.md points at the design reference', () => {
  // The two are read together: one is the mechanics, the other is what the
  // screen should look like. An agent that loaded only the mechanics is the
  // exact case this cross-reference exists to catch.
  const styling = readFileSync(join(SKILL_DIR, 'references/styling.md'), 'utf8');
  assert.match(styling.slice(0, 600), /references\/design\.md/);
});

test('the design reference stays inside the context budget it was split for', () => {
  // The core was split from the depth file so it can load ALONGSIDE
  // styling.md on every UI task. If it grows past its sibling it stops being
  // the cheap always-load file and the split has bought nothing.
  const core = readFileSync(join(SKILL_DIR, 'references/design.md'), 'utf8').split('\n').length;
  const styling = readFileSync(join(SKILL_DIR, 'references/styling.md'), 'utf8').split('\n').length;
  assert.ok(core <= 260, `design.md is ${core} lines, over its 260-line budget`);
  assert.ok(
    core <= styling * 1.2,
    `design.md (${core} lines) has outgrown styling.md (${styling}), so it is no longer the always-load file`,
  );
});
