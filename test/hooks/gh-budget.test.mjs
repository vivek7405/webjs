// Guards the GitHub API budget doctrine in `.claude/gh-budget.md`.
//
// GitHub scores GraphQL in POINTS (5000/hour) and REST in requests (5000/hour),
// and every `gh` porcelain READ goes to GraphQL. Sessions here exhausted that
// budget routinely, which left the project board unreachable and made two
// PostToolUse hooks fail silently. The rule is that reads go through
// `gh api` over REST, with GraphQL reserved for Projects V2 and
// `resolveReviewThread`, which is all that genuinely needs it.
//
// Prose is free to NAME a banned command while explaining why not to use it, so
// this scans only fenced code blocks, which is where a command is actually
// being prescribed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCTRINE = join(ROOT, '.claude/gh-budget.md');
const IDS = join(ROOT, '.claude/gh-ids.env');

/** Porcelain reads that spend the GraphQL point budget. Each has a REST form. */
const BANNED_READS = [
  'gh issue view',
  'gh issue list',
  'gh pr view',
  'gh pr list',
  'gh pr diff',
  'gh pr status',
  'gh search',
];

// `gh pr checks` is a DELIBERATE exception, documented in the doctrine: it is
// the merge gate, it merges check-runs and legacy commit statuses into one
// verdict, and the combined-status endpoint reports "pending" for a commit with
// no statuses, so the obvious one-call replacement calls a green PR pending.
// `gh pr merge` and `gh pr create` are exceptions too, for reasons in the file.

/** Every fenced code block in a markdown source. */
function codeBlocks(src) {
  return [...src.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

function skillFiles() {
  const dir = join(ROOT, '.claude/skills');
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('webjs-'))
    .map((e) => join(dir, e.name, 'SKILL.md'))
    .filter((p) => existsSync(p));
}

function hookFiles() {
  const dir = join(ROOT, '.claude/hooks');
  return readdirSync(dir).filter((f) => f.endsWith('.sh')).map((f) => join(dir, f));
}

test('the doctrine file exists and is TRACKED by git', () => {
  assert.ok(existsSync(DOCTRINE), '.claude/gh-budget.md must exist');
  // `.gitignore` carries a broad `.claude/*` rule, so a new file there is
  // ignored unless explicitly negated. Every skill links to this one, so an
  // untracked copy means a fresh clone gets dangling references and the rule
  // silently reverts to whatever each skill remembers.
  const tracked = execFileSync('git', ['ls-files', '--', '.claude/gh-budget.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assert.equal(tracked, '.claude/gh-budget.md', 'gh-budget.md must be committed, not gitignored');
});

test('the cached project ids are tracked and define what the skills source', () => {
  assert.ok(existsSync(IDS), '.claude/gh-ids.env must exist');
  const tracked = execFileSync('git', ['ls-files', '--', '.claude/gh-ids.env'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assert.equal(tracked, '.claude/gh-ids.env', 'gh-ids.env must be committed, not gitignored');

  const src = readFileSync(IDS, 'utf8');
  for (const key of ['PROJECT_ID', 'STATUS_FIELD_ID', 'STATUS_IN_PROGRESS']) {
    assert.match(src, new RegExp(`^${key}=`, 'm'), `${key} must be defined`);
  }
});

test('no skill or hook PRESCRIBES a GraphQL porcelain read', () => {
  const offenders = [];

  for (const file of skillFiles()) {
    const rel = relative(ROOT, file);
    for (const block of codeBlocks(readFileSync(file, 'utf8'))) {
      for (const banned of BANNED_READS) {
        if (block.includes(banned)) offenders.push(`${rel}: ${banned}`);
      }
    }
  }

  for (const file of hookFiles()) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      if (line.trimStart().startsWith('#')) continue; // a comment may name one
      for (const banned of BANNED_READS) {
        if (line.includes(banned)) offenders.push(`${rel}: ${banned}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these spend the GraphQL point budget on reads REST answers for free:\n  ${offenders.join('\n  ')}`,
  );
});

test('every reference to the doctrine file resolves', () => {
  const referrers = [...skillFiles(), ...hookFiles(), join(ROOT, 'AGENTS.md')];
  let found = 0;
  for (const file of referrers) {
    if (!existsSync(file)) continue;
    if (readFileSync(file, 'utf8').includes('.claude/gh-budget.md')) found += 1;
  }
  assert.ok(found >= 3, `expected several files to link the doctrine, found ${found}`);
  assert.ok(existsSync(DOCTRINE), 'and the file they link must exist');
});

test('the doctrine names its own exceptions, so they are not "fixed" later', () => {
  const src = readFileSync(DOCTRINE, 'utf8');
  for (const cmd of ['gh pr merge', 'gh pr create', 'gh pr checks']) {
    assert.ok(src.includes(cmd), `the doctrine must explain why ${cmd} stays on the porcelain`);
  }
});
