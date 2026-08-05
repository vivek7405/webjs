/**
 * Refuse outbound calls to a third-party host for the whole test run (#1150).
 *
 * Loaded by `scripts/run-node-tests.js` and `scripts/run-bun-tests.js` into
 * the test process, so no required check can depend on jspm.io or
 * registry.npmjs.org being up. `WEBJS_REQUIRE_NETWORK=1` turns it off, which
 * is the same switch that selects the `*.live.test.*` files.
 *
 * WHY THIS SHAPE, after three attempts at the other one. The first version of
 * this guard was a STATIC scan: mask a test file's strings and comments, then
 * look for a live host inside a `fetch(`. Three review rounds found three
 * different ways it went blind, each one hiding every call below it in the
 * file, and each fix opened a new hole:
 *
 *   1. A file-level exemption, so one `withMockedFetch` anywhere excused every
 *      live call in the file. It reported ZERO offenders for the very file
 *      this change had to convert.
 *   2. No regex-literal awareness, so `/rel=["']modulepreload["']/` desynced
 *      the mask from that line to EOF. Eighteen files carry that shape.
 *   3. Regex awareness that then read the `/` in `</li>` inside a nested
 *      ``html`...` `` template as a regex opener, swallowing the closing
 *      backtick and blinding thirteen more files.
 *
 * The lesson is not that the fourth heuristic would have been right. Deciding
 * whether a `/` opens a regex requires lexing JavaScript, and a hand-rolled
 * lexer facing nested template literals holding markup is going to keep being
 * wrong. A static scan is also structurally unable to see the callers that
 * matter most here: the app-boot tests reach jspm transitively through
 * `resolveVendorImports`, with no `fetch(` and no vendor entry point anywhere
 * in their source.
 *
 * Denying at runtime needs no parsing, and inside the test process it has no
 * blind spots. A test that depends on a third party now fails on EVERY run
 * rather than only during an outage, which is a better signal than any scan
 * could give, and it arrives the day the test is written instead of months
 * later.
 *
 * The one thing it does NOT cover is a SPAWNED child, which starts with its
 * own `globalThis`. `test/vendor-cli/vendor-cli.test.mjs` runs the CLI in
 * another process, so it passes its own preload and asserts a marker on every
 * spawn. A new test that spawns a process and vendors needs the same.
 *
 * WHY A 503 RATHER THAN A THROW. Every fetch caller in
 * `packages/server/src/vendor.js` catches, so a throw is indistinguishable
 * from a network error and would be swallowed. A 503 is the shape those call
 * sites already classify as transient, so vendor resolution degrades exactly
 * as it does during a real outage, which is the behaviour under test. It also
 * keeps the app-boot tests passing: they fail open and assert nothing about a
 * vendor entry, verified by running the whole suite this way.
 */

/** Hosts no required check may depend on. */
export const DENIED_HOSTS = ['api.jspm.io', 'ga.jspm.io', 'registry.npmjs.org'];

/**
 * Install the deny on a fetch-like function.
 *
 * Exported separately from the self-install below so the guard test can
 * exercise it without patching its own process.
 *
 * @param {(input: any, init?: any) => Promise<any>} realFetch
 * @param {(url: string) => void} [onDenied]
 * @returns {(input: any, init?: any) => Promise<any>}
 */
export function denyLiveHosts(realFetch, onDenied) {
  return async function deniedFetch(input, init) {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
        : (input && input.url) || '';
    const host = DENIED_HOSTS.find((h) => url.includes(h));
    if (!host) return realFetch(input, init);
    if (onDenied) onDenied(url);
    return new Response(
      JSON.stringify({ error: `Error: ${host} is denied during the test run` }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  };
}

if (!process.env.WEBJS_REQUIRE_NETWORK) {
  /** @type {Set<string>} */
  const seen = new Set();
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (denyLiveHosts(real, (url) => {
    // One line per distinct url, not per call, so a warmup that resolves
    // twenty packages does not bury the run. Visible on purpose: a required
    // test reaching a third party is worth knowing about even when it degrades
    // cleanly, and this is the list to work through if that ever stops being
    // acceptable.
    const key = url.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    process.stderr.write(`[deny-live-hosts] refused ${key}\n`);
  }));
}
