import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The scaffolded check-server-imports hook (#804): WARN at write time when a
// browser-facing module imports a server-only `.server.*` utility (no
// 'use server'), silent for a 'use server' action or an `import type`.
const HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..',
  'packages/cli/templates/.claude/hooks/check-server-imports.mjs',
);

function run(app, filePath, content) {
  const payload = JSON.stringify({ tool_input: { file_path: filePath, content } });
  return execFileSync('node', [HOOK, payload], { encoding: 'utf8' });
}

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-hook-'));
  mkdirSync(join(dir, 'db'), { recursive: true });
  mkdirSync(join(dir, 'modules', 'todos', 'components'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(join(dir, 'db', 'queries.server.ts'), 'export function q(){return 1}\n');
  writeFileSync(join(dir, 'modules', 'todos', 'actions.server.ts'), "'use server';\nexport async function a(){return 1}\n");
  return dir;
}

test('WARNs when a component imports a server-only utility (#804)', () => {
  const dir = makeApp();
  try {
    const out = run(dir, join(dir, 'modules/todos/components/list.ts'), "import { q } from '#db/queries.server.ts';\nexport class X {}");
    assert.match(out, /server-only utility/, 'warns about the server-only import');
    assert.match(out, /additionalContext/, 'emits a PreToolUse additionalContext warning');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('silent when the imported .server.ts is a use-server action (#804)', () => {
  const dir = makeApp();
  try {
    const out = run(dir, join(dir, 'modules/todos/components/list.ts'), "import { a } from '#modules/todos/actions.server.ts';\nexport class X {}");
    assert.equal(out.trim(), '', 'a use-server RPC action import is fine, no warning');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('silent for an import type from a server file (#804)', () => {
  const dir = makeApp();
  try {
    const out = run(dir, join(dir, 'modules/todos/components/list.ts'), "import type { T } from '#db/queries.server.ts';\nexport class X {}");
    assert.equal(out.trim(), '', 'a type-only import is erased by the stripper, no warning');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
