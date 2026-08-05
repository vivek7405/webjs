/**
 * The `sameAs` entity graph in the site's JSON-LD (#1100).
 *
 * The project owns a lot of properties that name the framework: this site, the
 * GitHub repo, the npm packages, several publishing profiles, and a Discord.
 * Without an explicit `sameAs`, a search engine sees each one as an unrelated
 * page that happens to contain the string, which matters here because the name
 * is contested (a dormant Java framework, a client-side toolkit, and the
 * common short form of whatsapp-web.js all collide with it).
 *
 * The claim belongs on every node that identifies the PROJECT: the
 * `Organization` and the `SoftwareApplication` on the home page, and the
 * `SoftwareApplication` on /what-is-webjs, which is the page that does the
 * disambiguating. The two SoftwareApplication nodes share a name and a url
 * with no `@id` between them, so they describe one entity and cannot make
 * different claims. The `WebSite` node is left out because it describes this
 * site as a document collection rather than the project.
 *
 * They must all state the SAME graph, which is the whole reason the list
 * lives in one exported constant. This asserts the rendered output, not the
 * constant, so an import that silently stops being used still fails, and it
 * derives the carriers from what is rendered rather than naming them, so a
 * node added later cannot quietly opt out.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE_DIR = resolve(ROOT, 'website');

/** Every page that emits JSON-LD naming the project. */
const PAGES = ['/', '/what-is-webjs'];

/** @type {(path: string) => Promise<string>} */
let getHtml;

before(async () => {
  const app = await createRequestHandler({ appDir: SITE_DIR, dev: false });
  getHtml = async (path) => {
    const res = await app.handle(new Request('http://localhost' + path));
    assert.equal(res.status, 200, `${path} renders`);
    return res.text();
  };
});

/** Every JSON-LD node the page emits, parsed. */
function jsonLdNodes(html) {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0, 'the page emits at least one JSON-LD block');
  return blocks.flatMap((m) => {
    const parsed = JSON.parse(m[1]);
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

const nodeOfType = (nodes, type) => nodes.find((n) => n['@type'] === type);

/** Read one page's `sameAs`, asserting the node that should carry it does. */
async function sameAsOf(path, type) {
  const nodes = jsonLdNodes(await getHtml(path));
  const node = nodeOfType(nodes, type);
  assert.ok(node, `${path} emits a ${type} node`);
  assert.ok(Array.isArray(node.sameAs), `the ${type} node on ${path} carries a sameAs array`);
  return node.sameAs;
}

test('the home page Organization node claims the owned properties', async () => {
  const sameAs = await sameAsOf('/', 'Organization');
  // The two anchors that make the claim worth anything: the repo (the highest
  // authority property naming the project) and npm (the surface a stranger is
  // most likely to arrive on).
  assert.ok(sameAs.includes('https://github.com/webjsdev/webjs'), 'includes the GitHub repo');
  assert.ok(
    sameAs.some((u) => u.startsWith('https://www.npmjs.com/package/')),
    'includes at least one npm package page',
  );
  // A two-entry list was the old state, and it is what this exists to move off.
  assert.ok(sameAs.length >= 8, `lists the owned properties, got ${sameAs.length}`);
});

test('the /what-is-webjs SoftwareApplication node claims the same properties', async () => {
  const sameAs = await sameAsOf('/what-is-webjs', 'SoftwareApplication');
  assert.ok(sameAs.includes('https://github.com/webjsdev/webjs'), 'includes the GitHub repo');
});

test('every node that states an entity claim states the same one', async () => {
  // The anti-drift assertion, and the reason the list is a shared constant.
  // The carriers are DERIVED from the rendered nodes, not listed here: a
  // hand-written list would be a second copy of exactly what the shared
  // constant exists to remove, and a node added later without a sameAs (or
  // with a different one) would pass it green.
  const nodes = (await Promise.all(PAGES.map(async (p) => (await jsonLdNodes(await getHtml(p))).map((n) => ({ ...n, page: p }))))).flat();

  const carriers = nodes.filter((n) => n.sameAs !== undefined);
  assert.ok(carriers.length >= 3, `found the sameAs carriers, got ${carriers.length}`);
  for (const node of carriers) {
    assert.deepEqual(
      node.sameAs,
      carriers[0].sameAs,
      `the ${node['@type']} node on ${node.page} emits the same sameAs, in the same order`,
    );
  }

  // And the types that identify the PROJECT must be carriers at all, so
  // deleting the property from one is a failure rather than a smaller set
  // that still agrees with itself. WebSite is excluded on purpose: it
  // describes this site as a document collection, not the project, which is
  // the entity the sameAs claim is about.
  for (const node of nodes.filter((n) => n['@type'] === 'Organization' || n['@type'] === 'SoftwareApplication')) {
    assert.ok(
      Array.isArray(node.sameAs),
      `the ${node['@type']} node on ${node.page} carries a sameAs`,
    );
  }
});

test('every claimed property is a distinct absolute https URL', async () => {
  // A malformed or duplicated entry is a wasted claim at best. Reachability is
  // verified by hand when a property is added, since a live network probe in
  // the test suite would make an offline run fail for no good reason.
  const sameAs = await sameAsOf('/', 'Organization');
  for (const url of sameAs) {
    assert.match(url, /^https:\/\/[^\s]+$/, `${url} is an absolute https URL`);
  }
  assert.equal(new Set(sameAs).size, sameAs.length, 'no duplicate entries');
});
