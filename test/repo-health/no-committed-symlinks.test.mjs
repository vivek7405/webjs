/**
 * No tracked file may be a SYMLINK that escapes the repo.
 *
 * A fresh git worktree has no `node_modules` and no built `packages/core/dist`
 * (#954), so the standard remedy is to borrow them from the primary checkout
 * with a symlink. That symlink is machine-local by construction: it holds an
 * ABSOLUTE path into one developer's home directory. Committing one puts that
 * path in every clone, and it dangles everywhere except the machine that made
 * it.
 *
 * This has happened. A `packages/core/dist` symlink was committed and reached
 * `main`, because `.gitignore` listed `dist/` WITH a trailing slash, which
 * matches a directory only. Git does not treat a symlink as a directory, so the
 * pattern never applied and a `git add -A` swept it in. The `.gitignore` entry
 * is now `dist` (no slash), and this test is the backstop for the general
 * shape, since the next borrowed path will not necessarily be called `dist`.
 *
 * In-repo symlinks are fine and several are load-bearing (the vendored nvim
 * intellisense copy, the ui registry), so the rule is about ESCAPING the repo,
 * not about symlinks as such: a target is rejected when it is absolute, or when
 * resolving it relative to the link's own directory lands outside the repo root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('no tracked symlink points outside the repo', () => {
  // Mode 120000 is git's symlink mode. `ls-files -s` prints it per tracked path.
  const out = execFileSync('git', ['ls-files', '-s'], { cwd: repoRoot, encoding: 'utf8' });
  const links = out
    .split('\n')
    .filter((l) => l.startsWith('120000 '))
    .map((l) => ({ oid: l.split(' ')[1], path: l.split('\t').slice(1).join('\t') }))
    .filter((l) => l.path);

  const escaping = [];
  for (const { oid, path } of links) {
    // The blob content of a symlink IS its target string. Read it by OID rather
    // than as `HEAD:<path>`, so a STAGED but not yet committed link is checked
    // too: `ls-files -s` above enumerates the index, and resolving against HEAD
    // mixed two snapshots, throwing a raw `fatal: path ... exists on disk, but
    // not in 'HEAD'` at exactly the moment someone adds a symlink and needs
    // this guard to judge it (#1372).
    const target = execFileSync('git', ['cat-file', '-p', oid], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();

    if (isAbsolute(target)) {
      escaping.push(`${path} -> ${target} (absolute, so machine-local)`);
      continue;
    }
    const resolved = resolve(join(repoRoot, dirname(path)), target);
    const rel = relative(repoRoot, resolved);
    if (rel.startsWith('..')) escaping.push(`${path} -> ${target} (resolves outside the repo)`);
  }

  assert.deepEqual(
    escaping,
    [],
    'a tracked symlink escapes the repo, so it dangles in every clone but the one that made it:\n  ' +
      escaping.join('\n  '),
  );
});

test('the build-output ignore patterns match a symlink, not just a directory', () => {
  // The specific gap that let the dist symlink through. `dist/` matches a
  // directory only; the entry must be slash-free so a symlink of that name is
  // caught too.
  const ignore = execFileSync('git', ['show', 'HEAD:.gitignore'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const lines = ignore.split('\n').map((l) => l.trim());
  for (const name of ['dist', 'build', 'out']) {
    assert.ok(
      lines.includes(name),
      `.gitignore must list a slash-free \`${name}\` so a symlink of that name is ignored too, ` +
        `not just a \`${name}/\` directory`,
    );
    assert.ok(
      !lines.includes(`${name}/`),
      `.gitignore still has \`${name}/\`, which matches a directory only and is what let a ` +
        `committed \`packages/core/dist\` symlink reach main`,
    );
  }
});
