/**
 * Answer the dev server's vendor resolve from this repo instead of the public
 * internet (#1228). Loaded into the SERVER process, not the harness, with
 * `node --import <this>` or `bun --preload <this>`.
 *
 * Why this exists. The `differential elision (#181)` block runs the blog twice
 * and asserts the two builds render identically. Elision ON drops
 * `components/vendor-badge.ts`, the blog's only vendor consumer, so
 * `scanBareImports` finds nothing, `api.jspm.io` is never called, `dayjs`
 * never enters the importmap, and the browser never contacts a third party.
 * That is the #170 property and another test asserts it. Elision OFF ships
 * that component, so the same page picks up two internet dependencies the ON
 * page does not have: a blocking `api.jspm.io/generate` POST on the server's
 * cold first request, and a `https://ga.jspm.io/...` module fetch inside
 * `app/page.ts`'s graph in the browser.
 *
 * ES module instantiation is all or nothing across a graph, so a failure at
 * either point means `app/page.ts` never evaluates, and neither does anything
 * it imports. `#components/counter.ts` is imported on line 2 and fetched
 * successfully every time, yet `customElements.define` never runs for it and
 * the SSR'd markup sits there inert. That is what redded this block on and off
 * from 2026-08-02, reported as an elision defect when it was a CDN reachability
 * failure. Both halves were reproduced on demand by failing each call in turn.
 *
 * Stubbing the API call closes BOTH holes at once, because the URL the browser
 * fetches is whatever this map says it is. Pointing `dayjs` at a `data:` URL
 * carrying this repo's own copy leaves nothing for the network to break.
 *
 * The stub is deliberately narrow. It serves exactly the packages listed in
 * LOCAL_VENDORS and passes everything else through to the real network, so a
 * vendor added to the blog later does not get silently faked: it either gets a
 * local entry here or it resolves for real, and neither outcome is a lie about
 * what was tested.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { splitInstall, packageName, subpath } from '../../fixtures/install-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Resolve from the app under test, not from a hardcoded path, so it does not
// matter whether npm hoisted the package to the workspace root or kept it in
// `examples/blog/node_modules`. Getting that wrong would not fail loudly: an
// unreadable file makes the stub pass through, quietly restoring the network
// dependency this fixture exists to remove.
const requireFromBlog = createRequire(join(ROOT, 'examples', 'blog', 'package.json'));

/**
 * Bare specifier to the wrapper that turns its installed entry file into an ES
 * module. The entry itself is whatever the package's own `main` names.
 *
 * dayjs ships UMD. Evaluated as a module it finds no `exports`, no `module`,
 * and no AMD `define`, so it takes its global branch and assigns
 * `globalThis.dayjs`, which the appended line then re-exports as the default.
 * The alternative, `dayjs/esm/index.js`, is a multi-file ESM build whose
 * relative imports a `data:` URL cannot resolve. `test/repo-health/
 * e2e-vendor-stub-module.test.mjs` imports the emitted module and formats a
 * date through it, so a dayjs that changed its wrapper fails there rather than
 * silently emitting a module that exports nothing.
 *
 * @type {Record<string, (src: string) => string>}
 */
const LOCAL_VENDORS = {
  dayjs: (src) => `${src}\nexport default globalThis.dayjs;\n`,
};

/** @param {string} name @returns {string | null} */
function localModuleUrl(name) {
  if (!Object.hasOwn(LOCAL_VENDORS, name)) return null;
  let src;
  try {
    const pkgPath = requireFromBlog.resolve(`${name}/package.json`);
    const main = JSON.parse(readFileSync(pkgPath, 'utf8')).main;
    if (typeof main !== 'string' || !main) return null;
    src = readFileSync(join(dirname(pkgPath), main), 'utf8');
  } catch { return null; }
  const body = LOCAL_VENDORS[name](src);
  return `data:text/javascript;base64,${Buffer.from(body, 'utf8').toString('base64')}`;
}

/**
 * The install-string parse lives in `test/fixtures/install-spec.mjs` so this
 * fixture and the offline jspm double (#1150) share one implementation rather
 * than each carrying its own. Re-exported here because this fixture's own test,
 * `test/repo-health/e2e-vendor-stub.test.mjs`, imports them from this path.
 *
 * A subpath install matters to this fixture in one specific way: it needs its
 * own importmap key pointing at its own file, which this fixture does not
 * build, so `localImportsFor` treats it as unserviceable rather than answering
 * it with the bare package's entry.
 */
export { splitInstall, packageName, subpath };

/**
 * Build the importmap this fixture would answer a `/generate` call with, or
 * null when any install is one it cannot serve from this repo.
 * @param {string[]} installs
 * @returns {Record<string, string> | null}
 */
export function localImportsFor(installs) {
  // An empty list means the body did not parse as expected. Answering it with
  // an empty map would be the exact silent failure this fixture removes (an
  // absent entry is an unresolved-bare-specifier error that kills the whole
  // page graph), so treat it as unserviceable.
  if (!installs.length) return null;
  /** @type {Record<string, string>} */
  const imports = {};
  for (const install of installs) {
    if (subpath(install)) return null;
    const name = packageName(install);
    const local = localModuleUrl(name);
    // Anything this repo cannot serve goes to the real API, so a vendor added
    // to the blog later resolves honestly rather than silently vanishing.
    if (!local) return null;
    imports[name] = local;
  }
  return imports;
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function stubbedFetch(input, init) {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
      : (input && input.url) || '';
  if (!url.includes('api.jspm.io')) return realFetch(input, init);

  /** @type {string[]} */
  let installs = [];
  try {
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (body && Array.isArray(body.install)) installs = body.install.filter((i) => typeof i === 'string');
  } catch { /* an unparseable body is unserviceable, handled below */ }

  const imports = localImportsFor(installs);
  if (!imports) return realFetch(input, init);

  return new Response(JSON.stringify({ map: { imports } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
