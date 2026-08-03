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
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Bare specifier to the file in this repo's `node_modules` that supplies it.
 *
 * `dayjs.min.js` is UMD. Evaluated as a module it finds no `exports`, no
 * `module`, and no AMD `define`, so it takes its global branch and assigns
 * `globalThis.dayjs`, which the appended line then re-exports as the default.
 * The alternative, `dayjs/esm/index.js`, is a multi-file ESM build whose
 * relative imports a `data:` URL cannot resolve.
 *
 * @type {Record<string, { file: string, wrap: (src: string) => string }>}
 */
const LOCAL_VENDORS = {
  dayjs: {
    file: join(ROOT, 'node_modules', 'dayjs', 'dayjs.min.js'),
    wrap: (src) => `${src}\nexport default globalThis.dayjs;\n`,
  },
};

/** @param {string} name @returns {string | null} */
function localModuleUrl(name) {
  const entry = LOCAL_VENDORS[name];
  if (!entry) return null;
  let src;
  try { src = readFileSync(entry.file, 'utf8'); }
  catch { return null; }
  const body = entry.wrap(src);
  return `data:text/javascript;base64,${Buffer.from(body, 'utf8').toString('base64')}`;
}

/**
 * An install string is `name`, `name@range`, or either plus a subpath
 * (`dayjs@1.11.21/plugin/utc`). The subpath always rides AFTER the version, so
 * cutting at the version separator yields the bare package name on its own. A
 * scoped name's leading `@` is not that separator, hence the offset start.
 * @param {string} install
 * @returns {string}
 */
export function packageName(install) {
  const at = install.indexOf('@', install.startsWith('@') ? 1 : 0);
  return at === -1 ? install : install.slice(0, at);
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
    if (body && Array.isArray(body.install)) installs = body.install;
  } catch { /* fall through to the real API below */ }

  /** @type {Record<string, string>} */
  const imports = {};
  for (const install of installs) {
    const name = packageName(install);
    const local = localModuleUrl(name);
    if (local) imports[name] = local;
  }
  // Any install this repo cannot serve locally goes to the real API, so an
  // unlisted vendor resolves honestly rather than vanishing from the map (an
  // absent entry is an unresolved-bare-specifier error that kills the whole
  // page graph, which is the exact failure this fixture exists to remove).
  if (Object.keys(imports).length !== installs.length) return realFetch(input, init);

  return new Response(JSON.stringify({ map: { imports } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
