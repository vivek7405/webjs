/**
 * Install the jspm double into a SPAWNED process (#1150).
 *
 * `test/vendor-cli/vendor-cli.test.mjs` runs the real CLI binary in a child
 * process, so the in-process `withJspmDouble` cannot reach it and the child
 * would resolve vendors against the live CDN. This module is what closes that
 * gap: the test passes it as `--import` (Node) or `--preload` (Bun) ahead of
 * the CLI path, and it patches `globalThis.fetch` before any application code
 * runs. It is loaded as a runtime flag rather than through `NODE_OPTIONS`
 * because Bun ignores `NODE_OPTIONS` and neither runtime honours the other's
 * flag, the lesson `test/e2e/e2e.test.mjs` already carries for #1229's stub.
 *
 * Two signals go to stderr, and both are load-bearing.
 *
 * `[jspm-double] armed` proves the preload actually took effect. Without it,
 * dropping the flag from `runCli` would leave every test green while silently
 * restoring the network dependency, because the CLI's observable output looks
 * the same either way. The CLI test asserts this marker on EVERY spawn rather
 * than on one, so no call site can lose the wiring unnoticed.
 *
 * A refusal line plus a non-zero `process.exitCode` is how an unserved request
 * fails the test. Every fetch caller in `packages/server/src/vendor.js`
 * swallows a throw, so a request this double does not serve would otherwise
 * degrade to "resolved nothing" and the CLI could still exit 0. Forcing the
 * exit code makes the existing `assert.equal(code, 0)` catch it.
 *
 * Configure it with a `WEBJS_JSPM_DOUBLE` env var holding the JSON options
 * `jspmDouble()` takes. Absent means resolve everything.
 */
import { jspmDouble } from './jspm-double.mjs';

/** @type {import('./jspm-double.mjs').JspmDoubleOptions} */
let opts = {};
const raw = process.env.WEBJS_JSPM_DOUBLE;
if (raw) {
  try {
    opts = JSON.parse(raw);
  } catch (err) {
    // A config this process cannot read must not silently become "serve
    // everything", since that is a different test than the one asked for.
    process.stderr.write(`[jspm-double] unreadable WEBJS_JSPM_DOUBLE: ${String(err)}\n`);
    process.exitCode = 1;
  }
}

const double = jspmDouble(opts);
let reported = 0;

globalThis.fetch = /** @type {any} */ (async function doubledFetch(input, init) {
  const response = await double(input, init);
  while (reported < double.unexpected.length) {
    process.stderr.write(`[jspm-double] refused ${double.unexpected[reported++]}\n`);
    process.exitCode = 1;
  }
  return response;
});

process.stderr.write('[jspm-double] armed\n');
