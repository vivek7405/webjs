import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyActionHole } from '../../src/js-scan.js';
import { PARSEABLE_ENCTYPES } from '../../../core/src/form-action.js';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';

/**
 * Tests for the form-action template primitives that outlived the
 * `submitter-needs-bound-form` rule (#1384 removed it, and with it the
 * whole-app form-scope scan it was built on).
 *
 * `classifyActionHole` is still live: the `form-action-not-a-get-action` rule
 * in `check.js` uses it to pair a tag with the attribute that binds an action.
 * The enctype tests pin the relationship between the renderer's allowlist and
 * the client guard's one-keyword denylist, which is a real cross-half drift
 * risk and has nothing to do with the removed rule.
 */

test('classifyActionHole matches the tag and the attribute as a pair', () => {
  assert.equal(classifyActionHole('<form action='), 'form');
  assert.equal(classifyActionHole('<button formaction='), 'submitter');
  assert.equal(classifyActionHole('<input formaction='), 'submitter');
  assert.equal(classifyActionHole('<div action='), null, 'a div binds nothing');
  assert.equal(classifyActionHole('<form formaction='), null, 'wrong attribute for the tag');
  assert.equal(classifyActionHole('<button action='), null, 'wrong attribute for the tag');
  assert.equal(classifyActionHole('<form action=x><span>'), null, 'the tag already closed');
  assert.equal(classifyActionHole('plain text'), null);
});

test('the enctype allowlist and the client guard do not drift apart', async () => {
  // The renderer refuses an enctype outside its allowlist; the client guard
  // declines only `text/plain`, the one encoding the server cannot parse. Pin
  // the relationship rather than asserting the two are equal, so a change to
  // core's set surfaces here instead of drifting silently.
  assert.ok(!PARSEABLE_ENCTYPES.has('text/plain'), 'the renderer cannot parse text/plain either');
  assert.deepEqual([...PARSEABLE_ENCTYPES].sort(),
    ['application/x-www-form-urlencoded', 'multipart/form-data'],
    'if core gains an enctype, revisit the client guard denylist');

  // Two hardcoded copies of the denylist keyword remain: the client guard in
  // `router-client.js` and this test. Pin the client one, so the two halves of
  // the feature cannot drift into disagreeing on the same input (which is what
  // the allowlist did).
  // router-client.js is a barrel over router-client/ now, so read the barrel
  // AND every module beneath it. The client guard this pins lives in
  // form-encoder.js, and scanning only the barrel would turn the first
  // assertion red and the second one vacuously green.
  const clientDir = new URL('../../../core/src/router-client/', import.meta.url);
  const clientSrc = (await Promise.all([
    readFile(new URL('../../../core/src/router-client.js', import.meta.url), 'utf8'),
    ...readdirSync(clientDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFile(new URL(f, clientDir), 'utf8')),
  ])).join('\n');
  assert.match(clientSrc, /enctype\.toLowerCase\(\) === 'text\/plain'/,
    'the client guard uses the same one-keyword denylist, not the renderer allowlist');
  assert.doesNotMatch(clientSrc, /PARSEABLE_ENCTYPES/,
    'and does not reach for the renderer allowlist again');
});

test('the renderer refuses an enctype it cannot honour', async () => {
  // The renderer asks whether the form does what the author wrote, and an
  // invalid value is the dangerous case: a typo'd `multipart/form-dat` falls
  // back to urlencoded and silently drops every FILE from the submission.
  const { html } = await import('../../../core/src/html.js');
  const { renderToString } = await import('../../../core/src/render-server.js');
  const { setFormActionResolver } = await import('../../../core/src/form-action.js');
  setFormActionResolver(async () => 'abc1234567/save');
  const save = async () => ({ success: true });

  await assert.rejects(
    () => renderToString(html`<form action=${save} enctype=${'multipart/form-dat'}></form>`, { ssr: true }),
    /cannot work|enctype/i,
  );
  await assert.rejects(
    () => renderToString(html`<form action=${save} enctype=${'text/plain'}></form>`, { ssr: true }),
    /cannot work|enctype/i,
  );
});
