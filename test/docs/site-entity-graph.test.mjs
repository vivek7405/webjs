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
 * Three nodes carry the claim: the `Organization` and the
 * `SoftwareApplication` on the home page, and the `SoftwareApplication` on
 * /what-is-webjs, which is the page that does the disambiguating. The two
 * SoftwareApplication nodes share a name and a url with no `@id` between
 * them, so they describe one entity and cannot make different claims.
 *
 * They must all state the SAME graph, which is the whole reason the list
 * lives in one exported constant. This asserts the rendered output, not the
 * constant, so an import that silently stops being used still fails.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE_DIR = resolve(ROOT, 'website');

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

test('every node that names the project states an identical graph', async () => {
  // The anti-drift assertion, and the reason the list is a shared constant. A
  // second hand-maintained copy would diverge on the next property added.
  // Listing the home page's own SoftwareApplication is the point: it is the
  // node most easily forgotten, being the third on a page whose Organization
  // already carries the claim.
  const carriers = [
    { path: '/', type: 'Organization' },
    { path: '/', type: 'SoftwareApplication' },
    { path: '/what-is-webjs', type: 'SoftwareApplication' },
  ];
  const [first, ...rest] = await Promise.all(carriers.map((c) => sameAsOf(c.path, c.type)));
  for (const [i, sameAs] of rest.entries()) {
    const c = carriers[i + 1];
    assert.deepEqual(sameAs, first, `${c.type} on ${c.path} emits the same sameAs, in the same order`);
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
