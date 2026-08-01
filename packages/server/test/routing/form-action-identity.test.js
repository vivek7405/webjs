/**
 * Resolving a bound `<form action=${action}>` back to `<hash>/<fn>` (#1155).
 *
 * Two paths, and until now only the happy one had coverage. The registry path
 * (the `'use server'` load hook saw the function load) is exercised by every
 * dispatch test. The SCAN fallback is not: those tests run on Node with the
 * hook installed, so `identityHookInstalled()` is true and the fallback returns
 * before its body runs. Replacing the whole function with `return null` left
 * the unit, browser, e2e and Bun suites green.
 *
 * This file is deliberately its own process (node:test runs one process per
 * file) and never calls `registerActionHooks`, so the hook is ABSENT and the
 * fallback is reachable, which is exactly the runtime it exists for.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let resolveActionIdentity, scanForIdentity, identityHookInstalled, __actionWrap;
before(async () => {
  ({ resolveActionIdentity, scanForIdentity } = await import('../../src/form-action-identity.js'));
  ({ identityHookInstalled, __actionWrap } = await import('../../src/action-seed.js'));
});

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'webjs-identity-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

/** An action index of the shape `buildActionIndex` produces. */
function indexOf(entries, dev = false) {
  const hashToFile = new Map(entries);
  const fileToHash = new Map([...hashToFile].map(([h, f]) => [f, h]));
  return { hashToFile, fileToHash, dev };
}

test('the load hook really is absent here, so the scan path is live', () => {
  assert.equal(identityHookInstalled(), false,
    'this file must not install the hook, or every assertion below is vacuous');
});

test('scanForIdentity finds a function by comparing the loaded module exports', async () => {
  const file = join(dir, 'scan.server.js');
  writeFileSync(file, `'use server';\nexport async function submitFeedback(fd) { return fd; }\n`);
  const mod = await import(`file://${file}`);
  const id = await scanForIdentity(indexOf([['aaaaaaaaaa', file]]), mod.submitFeedback);
  assert.equal(id, 'aaaaaaaaaa/submitFeedback');
});

test('the scan works in DEV, where a cache-busted import would break it', async () => {
  // The fallback matches on function-object IDENTITY against the instance the
  // page already holds. It used to import with a `?t=<now>` cache-bust in dev,
  // and a busted specifier is a NEW module whose exports are new objects, so
  // `value === fn` could never be true: the fallback imported every action
  // module and returned null every time, on exactly the runtime it exists for.
  const file = join(dir, 'dev-scan.server.js');
  writeFileSync(file, `'use server';\nexport async function createTodo(fd) { return fd; }\n`);
  const mod = await import(`file://${file}`);
  const id = await scanForIdentity(indexOf([['bbbbbbbbbb', file]], true), mod.createTodo);
  assert.equal(id, 'bbbbbbbbbb/createTodo', 'dev resolves the same identity as prod');
});

test('a function no indexed module exports resolves to null', async () => {
  const file = join(dir, 'other.server.js');
  writeFileSync(file, `'use server';\nexport async function unrelated() {}\n`);
  const id = await scanForIdentity(indexOf([['cccccccccc', file]]), async () => {});
  assert.equal(id, null);
});

test('an action outside the index resolves to null rather than minting a hash', async () => {
  // `actionFileHash` will SHA-256 any path string, so falling back to it always
  // produced an identity, including for a file the index does not contain (an
  // action imported from a linked workspace package, or a path whose realpath
  // differs from the walked one). The dispatcher then misses in `hashToFile`,
  // reads that as a deploy skew, and answers every submission with "This page
  // was updated while the form was open. Please submit again." forever, with
  // nothing logged. Null makes the renderer refuse loudly instead.
  const outside = join(dir, 'outside.server.js');
  const fn = async () => {};
  __actionWrap(outside, 'createWidget', fn);
  const indexed = join(dir, 'indexed.server.js');
  assert.equal(await resolveActionIdentity(indexOf([['dddddddddd', indexed]]), fn), null);
  // And the SAME function resolves once its file is indexed, so the null above
  // is about the index, not about the registration.
  assert.equal(
    await resolveActionIdentity(indexOf([['eeeeeeeeee', outside]]), fn),
    'eeeeeeeeee/createWidget',
  );
});

test('a barrel re-export resolves when the DEFINING module is outside the index', async () => {
  // The regression the defining-module-first rule can cause on its own. An
  // action can live outside the walked app tree (a linked workspace package),
  // re-exported through an in-app `'use server'` barrel. Preferring the
  // defining module unconditionally files it under a path the index never saw,
  // so the identity is unresolvable and the page 500s with "is not a server
  // action" for a function that IS one, and that worked before.
  //
  // Both registrations are kept, so the defining module wins when it is
  // indexed and the barrel carries it when it is not.
  const outside = join(dir, 'pkg', 'create.server.js');
  const barrel = join(dir, 'modules', 'index.server.js');
  const fn = async () => {};
  __actionWrap(outside, 'createTodo', fn);   // defining module, evaluated first
  __actionWrap(barrel, 'createTodo', fn);    // the in-app barrel re-exporting it

  // Only the barrel is indexed: it resolves rather than refusing.
  assert.equal(
    await resolveActionIdentity(indexOf([['1111111111', barrel]]), fn),
    '1111111111/createTodo',
  );
  // Both indexed: the DEFINING module wins, because it is the one carrying the
  // action's validate / middleware / method / invalidates config exports.
  assert.equal(
    await resolveActionIdentity(indexOf([['1111111111', barrel], ['2222222222', outside]]), fn),
    '2222222222/createTodo',
  );
  // Neither indexed: still null, and the server names the real cause.
  const empty = indexOf([['3333333333', join(dir, 'other.server.js')]]);
  const warned = [];
  const quiet = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    assert.equal(await resolveActionIdentity(empty, fn), null);
    // TWICE, because once-per-file is the claim. A single call cannot fail it:
    // the warn helper only runs once per call anyway, so deleting the guard
    // would leave a one-call assertion green.
    assert.equal(await resolveActionIdentity(empty, fn), null);
  } finally { console.warn = quiet; }
  assert.equal(warned.length, 1, 'exactly one warning across two renders, not one per render');
  assert.match(warned[0], /createTodo/);
  // The message lists the causes rather than asserting one: a symlinked appDir
  // makes the walked and loaded paths differ for a file that IS inside the app,
  // and confidently blaming a package that does not exist sends the author to
  // the wrong place.
  assert.match(warned[0], /outside the app directory, or/);
  assert.match(warned[0], /symlink/);
  // And the remedy has to say NAMED: a star re-export cannot be enumerated, so
  // the facade never wraps it and the page fails exactly as before.
  assert.match(warned[0], /NAMED re-export/);
  assert.match(warned[0], /star re-export cannot be/);
});

test('the barrel fallback warns that the action config exports are bypassed', async () => {
  // The fallback keeps the page working, but the dispatcher then reads
  // `validate` / `middleware` / `method` / `invalidates` off the BARREL, and a
  // re-export carries only the function. That is the very outcome the
  // defining-module preference exists to prevent, reached through the other
  // door, so it cannot be silent. It warns rather than refuses because the RPC
  // endpoint resolves the same barrel hash the same way: both transports agree,
  // and refusing would break a page that works.
  const outside = join(dir, 'pkg', 'cfg.server.js');
  const barrel = join(dir, 'modules', 'cfg-barrel.server.js');
  const fn = async () => {};
  __actionWrap(outside, 'updatePost', fn);
  __actionWrap(barrel, 'updatePost', fn);

  const warned = [];
  const quiet = console.warn;
  console.warn = (m) => warned.push(String(m));
  let id;
  try {
    id = await resolveActionIdentity(indexOf([['4444444444', barrel]]), fn);
    await resolveActionIdentity(indexOf([['4444444444', barrel]]), fn);
  } finally { console.warn = quiet; }
  assert.equal(id, '4444444444/updatePost', 'the form still works');
  assert.equal(warned.length, 1, 'once per defining module, not once per render');
  assert.match(warned[0], /validate/);
  assert.match(warned[0], /does NOT run/);

  // No warning when the defining module IS indexed: nothing is bypassed.
  const quiet2 = console.warn;
  const warned2 = [];
  console.warn = (m) => warned2.push(String(m));
  try {
    assert.equal(
      await resolveActionIdentity(indexOf([['4444444444', barrel], ['5555555555', outside]]), fn),
      '5555555555/updatePost',
    );
  } finally { console.warn = quiet2; }
  assert.equal(warned2.length, 0, 'the defining module resolved, so there is nothing to warn about');
});
