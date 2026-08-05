/**
 * An offline stand-in for api.jspm.io and ga.jspm.io (#1150).
 *
 * The required `Unit + integration` CI job used to resolve vendors against the
 * live jspm CDN, so a jspm outage redded pull requests that had nothing to do
 * with vendoring (#1149 was a five-file documentation change). This double is
 * what the vendor tests resolve against instead. Exactly one file in the tree,
 * `packages/server/test/vendor/jspm-cdn.live.test.js`, still talks to the real
 * CDN, and both test runners keep `*.live.test.*` out of a normal run.
 *
 * It models jspm rather than merely answering, because `packages/server/src/
 * vendor.js` is built on jspm's exact failure semantics. `jspmGenerate` sends
 * one unified call for a multi-install set, and its whole fallback ladder keys
 * off what comes back: a 5xx or a 429 is transient and retries per package, a
 * 4xx is permanent and triggers per-install probes so the resolvable ones
 * survive. A double that answered every request with a 200 would leave that
 * ladder untested while looking green.
 *
 * The `/double.js` tail on every minted URL is load-bearing. Real jspm never
 * emits it, so a test can assert on it to prove it is talking to this double
 * and not to the network. `test/vendor-cli/vendor-cli.test.mjs` does exactly
 * that, because its own `ga.jspm.io/npm:picocolors@` prefix check is equally
 * true of the real CDN and so cannot notice the double being unplugged.
 *
 * REFUSAL IS RECORDED, NOT THROWN. Every fetch caller in vendor.js swallows a
 * throw (`jspmCall`, `downloadBundle`, `fetchIntegrity`, `fetchLiveIntegrity`
 * all catch and degrade), so a double that threw on an unexpected request
 * would silently turn into "resolved nothing" and a weak assertion would still
 * pass. Unexpected requests land on `double.unexpected` instead, which
 * `withJspmDouble` asserts is empty and the preload turns into a non-zero exit.
 *
 * This is deliberately NOT the same fixture as `test/e2e/fixtures/
 * stub-jspm.mjs`. That one must emit a real executable module for a browser to
 * run, and it passes anything it cannot serve through to the real network. This
 * one only needs jspm-SHAPED urls and some bytes, and it must never pass
 * anything through. Keep them separate.
 *
 * This module has NO side effects. Importing it patches nothing; call
 * `jspmDouble()` or `withJspmDouble()` to use it.
 */
import { importKey, splitInstall } from './install-spec.mjs';

/** Hosts this double owns. A request to any of them must never reach the network. */
const OWNED_HOSTS = ['api.jspm.io', 'ga.jspm.io', 'registry.npmjs.org'];

const GENERATE_ENDPOINT = 'https://api.jspm.io/generate';

/** The body a minted bundle url serves, when a caller does not supply one. */
const DEFAULT_BUNDLE = 'export default "offline jspm double bundle";\n';

/**
 * @typedef {object} JspmDoubleOptions
 * @property {string[]} [unresolvable]
 *   Installs jspm cannot resolve. Real jspm fails the WHOLE batch with a 401
 *   when any single install is unresolvable (`vendor.js` documents this as the
 *   reason `jspmGenerate` probes per package on a permanent failure), so
 *   listing one install here fails every call that carries it.
 * @property {Record<string, string>} [transitives]
 *   Extra `{ importKey: url }` entries folded into an answer alongside the
 *   requested installs, standing in for the flattened transitives a real
 *   unified resolve returns (#446). Only added when the call resolved, since
 *   jspm cannot hoist a transitive out of nothing.
 * @property {number} [status]
 *   Force every `/generate` call to this HTTP status. Use it for the transient
 *   paths (503, 429), which `vendor.js` retries per package rather than
 *   probing.
 * @property {string} [bundle]
 *   The body a minted bundle URL serves. Defaults to a tiny ES module.
 */

/**
 * Build an offline `fetch` that answers jspm.
 *
 * @param {JspmDoubleOptions} [opts]
 */
export function jspmDouble(opts = {}) {
  const unresolvable = new Set(opts.unresolvable || []);
  const transitives = opts.transitives || {};
  const bundle = opts.bundle ?? DEFAULT_BUNDLE;

  /** @type {Array<{ url: string, method: string, installs: string[] }>} */
  const calls = [];
  /** @type {string[]} */
  const unexpected = [];
  /** Every bundle url this double has handed out, so a GET can be recognised. */
  const minted = new Set();

  /**
   * The url a resolved install is served from. Keeping `<name>@<version>` in
   * the path verbatim matters: `derivePinParts` in vendor.js recovers a
   * flattened transitive's version by locating exactly that substring in the
   * resolved url, and `pinAll` cannot derive a `--download` filename without
   * it.
   * @param {string} install
   */
  const mint = (install) => {
    const { name, version, subpath } = splitInstall(install);
    // An install with no pinned version still has to produce a parseable url,
    // and jspm would have chosen a concrete version here.
    const url = `https://ga.jspm.io/npm:${name}@${version || '0.0.0'}${subpath}/double.js`;
    minted.add(url);
    return url;
  };

  /** @param {any} input */
  const urlOf = (input) => (typeof input === 'string' ? input
    : input instanceof URL ? input.href
      : (input && input.url) || '');

  /** @param {any} init */
  const installsOf = (init) => {
    try {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (body && Array.isArray(body.install)) {
        return body.install.filter((/** @type {unknown} */ i) => typeof i === 'string');
      }
    } catch { /* an unreadable body names no installs, handled by the caller */ }
    return [];
  };

  /** @param {number} status @param {unknown} body */
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

  /**
   * @param {any} input
   * @param {any} [init]
   * @returns {Promise<Response>}
   */
  async function doubledFetch(input, init) {
    const url = urlOf(input);
    const method = (init && init.method) || 'GET';

    if (url === GENERATE_ENDPOINT || url.startsWith(`${GENERATE_ENDPOINT}?`)) {
      const installs = installsOf(init);
      calls.push({ url, method, installs });

      // A caller that named no installs sent something this double cannot
      // read. Answering `{}` would be the silent failure the whole fixture
      // exists to remove, since an absent importmap entry is an unresolved
      // bare specifier that kills a page's entire module graph.
      if (!installs.length) {
        unexpected.push(`${method} ${url} (no readable install list)`);
        return json(400, { error: 'Error: no install list' });
      }

      if (opts.status && opts.status !== 200) {
        return json(opts.status, { error: `Error: forced ${opts.status}` });
      }

      // Real jspm fails the WHOLE batch, not the individual entry. That is the
      // premise `jspmGenerate`'s per-package probing is built on, and
      // `packages/server/test/vendor/jspm-cdn.live.test.js` re-checks it
      // against the real API nightly.
      if (installs.some((/** @type {string} */ i) => unresolvable.has(i))) {
        return json(401, { error: 'Error: Not Found' });
      }

      /** @type {Record<string, string>} */
      const imports = {};
      for (const install of installs) imports[importKey(install)] = mint(install);
      // Transitives are hoisted by the unified resolve, so they ride along
      // with a successful answer rather than appearing on their own.
      for (const [key, target] of Object.entries(transitives)) {
        imports[key] = target;
        minted.add(target);
      }
      return json(200, { map: { imports } });
    }

    if (minted.has(url)) {
      calls.push({ url, method, installs: [] });
      return new Response(bundle, {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      });
    }

    if (OWNED_HOSTS.some((h) => url.includes(h))) {
      // Recorded rather than thrown: vendor.js catches every fetch rejection,
      // so a throw here would be indistinguishable from "the CDN was down" and
      // would quietly weaken whatever test hit it.
      unexpected.push(`${method} ${url}`);
      return json(599, { error: 'Error: the jspm double was not asked to serve this' });
    }

    unexpected.push(`${method} ${url} (not a jspm double host)`);
    return json(599, { error: 'Error: the jspm double does not proxy to the network' });
  }

  return Object.assign(doubledFetch, {
    calls,
    /** Just the `/generate` calls, which is what a round-trip count means. */
    get generateCalls() { return calls.filter((c) => c.url.startsWith(GENERATE_ENDPOINT)); },
    unexpected,
    minted,
  });
}

/**
 * Run `body` with the double installed on `globalThis.fetch`, then restore.
 *
 * The vendor caches are cleared on both sides, because they are keyed on the
 * install set and would otherwise carry one test's answer into the next. Any
 * request the double refused throws at the end, which is what makes an
 * unplugged or mis-shaped double loud instead of silent.
 *
 * `vendor.js` is imported lazily, and by relative path rather than as
 * `@webjsdev/server`, for two reasons. Lazily, so the preload arm can load
 * `jspmDouble` into a spawned CLI without dragging server source in behind it.
 * By relative path, so this clears the caches of the same module instance
 * `packages/server/test/vendor/vendor.test.js` imports; a bare specifier
 * resolves through `node_modules`, which in a linked worktree is a different
 * checkout and therefore a different set of caches.
 *
 * @template T
 * @param {JspmDoubleOptions} opts
 * @param {(double: ReturnType<typeof jspmDouble>) => Promise<T>} body
 * @returns {Promise<T>}
 */
export async function withJspmDouble(opts, body) {
  const { clearVendorCache } = await import(
    new URL('../../packages/server/src/vendor.js', import.meta.url).href
  );
  const double = jspmDouble(opts);
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (double);
  clearVendorCache();
  try {
    return await body(double);
  } finally {
    globalThis.fetch = original;
    clearVendorCache();
    if (double.unexpected.length) {
      throw new Error(
        `the jspm double was asked for ${double.unexpected.length} request(s) it does not serve:\n  ` +
        `${double.unexpected.join('\n  ')}`,
      );
    }
  }
}
