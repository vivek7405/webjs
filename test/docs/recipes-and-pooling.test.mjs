/**
 * Tests for #272 (updated in #969): the recipe content (the canonical recipes +
 * the persistence anti-pattern) now lives in the WebJs skill, not the retired
 * .agents/skills/webjs/references/data-and-actions.md, plus the deployment-doc Postgres connection-pool section.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequestHandler } from '@webjsdev/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
// The docs are served by the marketing app at webjs.dev/docs.
const DOCS_DIR = resolve(ROOT, 'website');

test('the skill carries the canonical recipes and the persistence rule (recipes.md was retired into the skill)', async () => {
  const skill = await readFile(resolve(ROOT, '.agents', 'skills', 'webjs', 'SKILL.md'), 'utf8');
  // The common recipes (a page, a server action, an interactive component, a
  // dynamic route) live in the skill's Canonical Patterns, distributed from the
  // retired recipes.md.
  for (const p of ['A page', 'A server action', 'An interactive component']) {
    assert.ok(skill.includes(p), `SKILL.md must include the "${p}" pattern`);
  }
  assert.ok(/dynamic route/i.test(skill), 'SKILL.md covers a dynamic route');
  // Schema-first + the data layer.
  const data = await readFile(resolve(ROOT, '.agents', 'skills', 'webjs', 'references', 'data-and-actions.md'), 'utf8');
  assert.ok(/schema\.server\.ts/.test(skill + data), 'covers the Drizzle schema');
  assert.ok(/queries\/|actions\//.test(data), 'covers one-file-per query/action');
  // The persistence anti-pattern (never JSON files) lives in the root AGENTS.md.
  const agents = await readFile(resolve(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(/NEVER use JSON files|never JSON files/i.test(agents), 'AGENTS.md warns against JSON-file persistence');
  void existsSync;
});

test('the deployment doc documents Postgres connection pooling', async () => {
  const app = await createRequestHandler({ appDir: DOCS_DIR, dev: false });
  if (app.warmup) await app.warmup();
  const res = await app.handle(new Request('http://localhost/docs/deployment'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(/new Pool\(\{[^}]*max|max: (1|10)/.test(html), 'documents bounding the pg Pool with max (not a Prisma connection_limit URL param)');
  assert.ok(/pooler|PgBouncer/i.test(html), 'documents when to use a pooler');
  assert.ok(/max_connections/.test(html), 'explains the max_connections constraint');
  assert.ok(/DATABASE_URL="postgresql:/.test(html), 'gives a concrete DATABASE_URL example');
  assert.ok(/single|one Node process|per instance/i.test(html), 'sizes it for the single-process server');
});
