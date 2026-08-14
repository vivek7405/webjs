/**
 * Every registry component's header carries a Design block beside its A11y
 * block (#1116).
 *
 * `webjsui add` copies a component's source into the user's own repo, headers
 * and all, so the header is read where the decision is actually made: at the
 * call site, by whoever is placing the component. That is a better home for
 * hierarchy intent than a reference file the agent may never load.
 *
 * The assertion is structural rather than a spot check, so a component added
 * later cannot quietly ship without one. It deliberately does NOT check the
 * prose, which is not something a test can judge; it checks that the author
 * was made to write some.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/registry/components',
);

const files = readdirSync(COMPONENTS).filter((f) => f.endsWith('.ts')).sort();

test('there is at least a full kit here, so a bad glob cannot pass vacuously', () => {
  assert.ok(files.length >= 38, `only ${files.length} components found`);
});

for (const file of files) {
  test(`${file} carries both a Design and an A11y block`, () => {
    const src = readFileSync(join(COMPONENTS, file), 'utf8');
    const header = src.slice(0, src.indexOf('*/'));
    assert.match(header, /^ \* Design:/m, `${file} has no Design block in its header`);
    assert.match(header, /^ \* A11y/m, `${file} has no A11y block in its header`);
  });

  test(`${file}'s Design block says something`, () => {
    const src = readFileSync(join(COMPONENTS, file), 'utf8');
    const header = src.slice(0, src.indexOf('*/'));
    const start = header.search(/^ \* Design:/m);
    const rest = header.slice(start);
    const end = rest.search(/^ \* [A-Z][a-z]+ (tokens|\()/m);
    const block = (end === -1 ? rest : rest.slice(0, end)).replace(/^ \* ?/gm, '').trim();
    // Three lines is not a high bar, and it is enough to stop a one-line
    // placeholder standing in for the intent the block exists to carry.
    assert.ok(block.length > 120, `${file}'s Design block is too short to be intent: ${JSON.stringify(block)}`);
  });
}
