/**
 * The Claude skill set, the Antigravity symlink set, and the documented list
 * must agree.
 *
 * Skills live once at `.claude/skills/<name>/SKILL.md` and are mirrored into
 * `.agents/skills/<name>` as relative symlinks, because Antigravity reads
 * `<workspace-root>/.agents/skills/<folder>/SKILL.md`. Nothing kept the two in
 * step, so three skills shipped with no symlink and a fourth was symlinked but
 * never documented (#1372). Every new skill reopens that gap, so assert it.
 *
 * Both sets are read from `git ls-files`, not from the filesystem, so the
 * machine-local `.agents/skills/omarchy` link (untracked, .gitignore:98) is
 * invisible by construction and needs no special case. The one tracked
 * exception is `.agents/skills/webjs/`, a real directory holding the framework
 * teaching skill, which has no `.claude/skills` counterpart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RULES_DOC = '.agents/rules/workflow.md';
/** Tracked entries under .agents/skills/ that are directories, not mirrors. */
const REAL_DIRS = new Set(['webjs']);

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });

/** Skill names with a committed `.claude/skills/<name>/SKILL.md`. */
function claudeSkillNames() {
  return [
    ...new Set(
      git('ls-files', '.claude/skills')
        .split('\n')
        .filter((p) => p.endsWith('/SKILL.md'))
        .map((p) => p.split('/')[2]),
    ),
  ].sort();
}

/** Map of `.agents/skills/<name>` symlink name to its stored target string. */
function agentsSkillLinks() {
  const map = new Map();
  for (const line of git('ls-files', '-s', '.agents/skills').split('\n')) {
    // Mode 120000 is git's symlink mode; the blob content IS the target string.
    if (!line.startsWith('120000 ')) continue;
    const path = line.split('\t').slice(1).join('\t');
    const oid = line.split(' ')[1];
    map.set(path.slice('.agents/skills/'.length), git('cat-file', '-p', oid).trim());
  }
  return map;
}

test('every committed .claude skill is mirrored into .agents/skills', () => {
  const links = agentsSkillLinks();
  const missing = claudeSkillNames().filter((n) => !links.has(n));
  assert.deepEqual(
    missing,
    [],
    `no .agents/skills symlink for: ${missing.join(', ')}. ` +
      `Add it with: cd .agents/skills && ln -s ../../.claude/skills/<name> <name>`,
  );
});

test('every .agents/skills symlink is relative and names its own skill', () => {
  const bad = [];
  for (const [name, target] of agentsSkillLinks()) {
    const want = `../../.claude/skills/${name}`;
    if (target !== want) bad.push(`${name} -> ${target} (expected ${want})`);
  }
  assert.deepEqual(bad, [], `a mirror symlink has the wrong target:\n  ${bad.join('\n  ')}`);
});

test('no .agents/skills symlink dangles', () => {
  const tracked = new Set(git('ls-files', '.claude/skills').split('\n').filter(Boolean));
  const dangling = [...agentsSkillLinks().keys()].filter(
    (n) => !tracked.has(`.claude/skills/${n}/SKILL.md`),
  );
  assert.deepEqual(dangling, [], `symlink with no committed target: ${dangling.join(', ')}`);
});

test('the workspace rules file documents exactly the mirrored skills', () => {
  const section = readFileSync(resolve(repoRoot, RULES_DOC), 'utf8').split(
    '## Custom Skills Usage',
  )[1];
  assert.ok(section, `${RULES_DOC} must keep its "## Custom Skills Usage" section`);
  const listed = new Set([...section.matchAll(/^\s*-\s+`([a-z0-9-]+)`:/gm)].map((m) => m[1]));
  const linked = new Set(agentsSkillLinks().keys());
  const undocumented = [...linked].filter((n) => !listed.has(n)).sort();
  const phantom = [...listed].filter((n) => !linked.has(n) && !REAL_DIRS.has(n)).sort();
  assert.deepEqual(
    undocumented,
    [],
    `symlinked but not listed in ${RULES_DOC}: ${undocumented.join(', ')}`,
  );
  assert.deepEqual(
    phantom,
    [],
    `listed in ${RULES_DOC} but not symlinked: ${phantom.join(', ')}`,
  );
});

test('the framework teaching skill stays a real committed directory', () => {
  const modes = git('ls-files', '-s', '.agents/skills/webjs')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' ')[0]);
  assert.ok(modes.length > 0, '.agents/skills/webjs must stay committed');
  assert.ok(
    !modes.includes('120000'),
    '.agents/skills/webjs is the canonical teaching skill and must not become a symlink',
  );
});

test('the machine-local omarchy link stays untracked', () => {
  assert.equal(
    git('ls-files', '.agents/skills/omarchy').trim(),
    '',
    'omarchy is a machine-local absolute symlink and must stay untracked (.gitignore:98)',
  );
});
