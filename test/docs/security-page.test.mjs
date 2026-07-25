/**
 * Integration test for the /docs/security page (#274): the consolidated
 * security reference. Boots the docs app via createRequestHandler (prod) and
 * asserts the page serves and covers the surfaces the issue requires (CSRF
 * model + the REST-endpoint exemption, CSP nonce, secure headers, the .server
 * boundary, sessions/secrets, rate limiting, SRI, body limits), that it is
 * registered in the sidebar nav, and that it links the deployment checklist.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The docs are served by the marketing app at webjs.dev/docs.
const DOCS_DIR = resolve(__dirname, '..', '..', 'website');

/** @type {(path: string) => Promise<Response>} */
let handle;

before(async () => {
  const app = await createRequestHandler({ appDir: DOCS_DIR, dev: false });
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

test('/docs/security serves and covers the required security surfaces', async () => {
  const res = await handle('/docs/security');
  assert.equal(res.status, 200, 'the security page serves');
  const html = await res.text();

  // Each acceptance-criterion surface is present.
  for (const needle of [
    'CSRF', // the CSRF model
    'route.ts', // the REST-endpoint exemption + checklist
    'NOT CSRF-protected', // the sharp edge is called out explicitly
    'Content-Security-Policy', // CSP nonce
    'cspNonce', // how to consume the nonce
    '.server', // the source-protection boundary
    'X-Frame-Options', // secure headers
    'AUTH_SECRET', // session secret handling
    'WEBJS_PUBLIC_', // the fail-closed env boundary
    'rateLimit(', // rate limiting
    'Subresource Integrity', // SRI
    'maxBodyBytes', // request body limits
    'Automatic', // the automatic-vs-opt-in framing
  ]) {
    assert.ok(html.includes(needle), `security page must mention ${needle}`);
  }

  // Links the deployment checklist for the go-live overlap.
  assert.ok(html.includes('/docs/deployment'), 'security page links the deployment checklist');
});

test('the security page is registered in the sidebar nav', async () => {
  // The sidebar is rendered into every docs page, so any docs page carries
  // the nav link once the entry is added to docs/app/docs/layout.ts.
  const res = await handle('/docs/getting-started');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(
    /href="\/docs\/security"/.test(html),
    'the sidebar nav must contain a link to /docs/security',
  );
});
