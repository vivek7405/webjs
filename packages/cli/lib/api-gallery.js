/**
 * Backend-features showcase for `webjs create --template api`.
 * A set of JSON/HTTP endpoints under `app/api/features/` that demonstrate the
 * backend capabilities an API app uses (the api counterpart of the UI gallery).
 * Extracted here to keep create.js readable and dodge
 * nested-template-literal escaping: files are built from arrays of
 * double-quoted strings, so `${...}` and backticks are emitted literally.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Write the api backend-features gallery into `<appDir>/app/api/features/**`
 * plus a boot-time env-validation example at `app/env.ts`. Each demo carries a
 * comment naming exactly what to delete when it is pruned.
 * @param {string} appDir
 */
export async function writeApiGallery(appDir) {
  const feat = (...p) => join(appDir, 'app', 'api', 'features', ...p);

  // 1) route() adapter + input validation.
  await mkdir(join(appDir, 'modules', 'widgets', 'actions'), { recursive: true });
  await writeFile(join(appDir, 'modules', 'widgets', 'actions', 'create-widget.server.ts'), [
    "'use server';",
    "",
    "// A plain 'use server' mutation. Exposed over REST by the route() adapter in",
    "// app/api/features/validate/route.ts, which merges the query + params + JSON",
    "// body into one input, runs the boundary validator, and JSON-responds.",
    "export async function createWidget(input: { name: string }) {",
    "  return { id: crypto.randomUUID(), name: input.name, createdAt: new Date().toISOString() };",
    "}",
    "",
  ].join('\n'));
  await mkdir(feat('validate'), { recursive: true });
  await writeFile(feat('validate', 'route.ts'), [
    "// API backend-features demo. Keep and adapt it, or prune it (delete this app/api/features/validate route AND modules/widgets).",
    "// route() turns a 'use server' action into a REST endpoint: it merges the URL",
    "// query, route params, and JSON body into one input, runs `validate` at the",
    "// boundary (a { success:false, fieldErrors } return is a 422, no action call),",
    "// then JSON-responds the result. POST { \"name\": \"Gadget\" } to try it.",
    "import { route } from '@webjsdev/server';",
    "import { createWidget } from '#modules/widgets/actions/create-widget.server.ts';",
    "",
    "const validate = (input: { name?: unknown }) => {",
    "  const name = typeof input?.name === 'string' ? input.name.trim() : '';",
    "  if (!name) return { success: false as const, fieldErrors: { name: 'name is required' } };",
    "  return { success: true as const, data: { name } };",
    "};",
    "",
    "// A GET returns usage so the endpoint is explorable in a browser; the real",
    "// validated action is the POST below.",
    "export async function GET(req: Request) {",
    "  const base = new URL(req.url).origin;",
    "  return Response.json({",
    "    method: 'POST',",
    "    usage: 'POST JSON { name } to validate the input and create a widget; an empty name returns a 422 with fieldErrors.',",
    "    example: 'curl -X POST -H content-type:application/json -d {\"name\":\"Gadget\"} ' + base + '/api/features/validate',",
    "  });",
    "}",
    "",
    "export const POST = route(createWidget, { validate });",
    "",
  ].join('\n'));

  // 2) Rate limiting (middleware scoped to this endpoint).
  await mkdir(feat('rate-limit'), { recursive: true });
  await writeFile(feat('rate-limit', 'middleware.ts'), [
    "// Per-segment middleware: it sits beside this route, so it rate-limits ONLY",
    "// /api/features/rate-limit. rateLimit() is backed by the pluggable cache store",
    "// (in-memory by default; point it at Redis to share the window across nodes).",
    "//",
    "// `trustProxy: true` decides WHAT gets counted. Without it the bucket key is",
    "// the socket peer, which is the visitor only when the browser connects to you",
    "// directly. Behind a CDN or a platform router the peer is that proxy, so a",
    "// proxy POOL hands out one bucket per proxy and multiplies your real limit by",
    "// the pool size. With it the key is the forwarded client address instead.",
    "//",
    "// It has a precondition: the proxy in front MUST strip an inbound",
    "// X-Forwarded-For before adding its own, or a client can forge the header and",
    "// pick its own bucket. Serving with nothing in front? Drop the option, since",
    "// then the socket peer IS the visitor. WEBJS_NO_TRUST_PROXY=1 outranks it either",
    "// way. https://webjs.dev/docs/rate-limiting has the full threat model.",
    "import { rateLimit } from '@webjsdev/server';",
    "",
    "export default rateLimit({",
    "  window: '10s',",
    "  max: 5,",
    "  trustProxy: true,",
    "  message: 'Slow down: five requests per ten seconds.',",
    "});",
    "",
  ].join('\n'));
  await writeFile(feat('rate-limit', 'route.ts'), [
    "// API backend-features demo. Keep and adapt it, or prune it (delete this app/api/features/rate-limit route).",
    "// The middleware.ts beside this file stamps X-RateLimit-* headers and returns",
    "// a 429 with Retry-After once the window is exhausted, so this handler never",
    "// runs on a limited request. Call it six times in ten seconds to see the 429.",
    "export async function GET() {",
    "  return Response.json({ ok: true, at: new Date().toISOString() });",
    "}",
    "",
  ].join('\n'));

  // 3) Streaming response (chunks flushed as produced, no buffering).
  await mkdir(feat('stream'), { recursive: true });
  await writeFile(feat('stream', 'route.ts'), [
    "// API backend-features demo. Keep and adapt it, or prune it (delete this app/api/features/stream route).",
    "// Streams JSON-per-line chunks as they are produced, so a slow or large",
    "// result is delivered incrementally instead of buffered whole. A hand-written",
    "// route.ts returns a ReadableStream for full control. Served as text/plain so",
    "// it renders INLINE and incrementally in a browser (application/x-ndjson would",
    "// make the browser download a file instead); `curl -N` shows the same lines",
    "// arrive one at a time.",
    "export async function GET() {",
    "  const encoder = new TextEncoder();",
    "  const stream = new ReadableStream({",
    "    async start(controller) {",
    "      for (let i = 1; i <= 5; i++) {",
    "        controller.enqueue(encoder.encode(JSON.stringify({ n: i, at: new Date().toISOString() }) + '\\n'));",
    "        await new Promise((r) => setTimeout(r, 200));",
    "      }",
    "      controller.close();",
    "    },",
    "  });",
    "  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } });",
    "}",
    "",
  ].join('\n'));

  // 4) File storage (upload + serve), both hand-written route.ts.
  await mkdir(feat('files', '[key]'), { recursive: true });
  await writeFile(feat('files', 'route.ts'), [
    "// API backend-features demo. Keep and adapt it, or prune it (delete this app/api/features/files route).",
    "// POST a multipart file: the bytes stream into the FileStore (a local",
    "// .webjs/uploads dir by default, gitignored; swap for S3/R2 with one",
    "// setFileStore() call). Returns the key + a URL served by [key]/route.ts.",
    "// Try: curl -F file=@README.md http://localhost:8080/api/features/files",
    "import { getFileStore, generateKey } from '@webjsdev/server';",
    "",
    "// A GET on the upload endpoint returns usage, so it is explorable in a browser",
    "// (the real upload is the POST below).",
    "export async function GET(req: Request) {",
    "  const base = new URL(req.url).origin;",
    "  return Response.json({",
    "    method: 'POST',",
    "    usage: 'POST a multipart form with a `file` field to upload.',",
    "    example: 'curl -F file=@README.md ' + base + '/api/features/files',",
    "    serve: base + '/api/features/files/<key>',",
    "  });",
    "}",
    "",
    "export async function POST(req: Request) {",
    "  const form = await req.formData();",
    "  const file = form.get('file');",
    "  if (!(file instanceof File) || file.size === 0) {",
    "    return Response.json({ error: 'no file provided' }, { status: 400 });",
    "  }",
    "  const key = generateKey(file.name);",
    "  const { size, contentType } = await getFileStore().put(key, file, { contentType: file.type });",
    "  const base = new URL(req.url).origin;",
    "  return Response.json({ key, size, contentType, url: `${base}/api/features/files/${key}` });",
    "}",
    "",
  ].join('\n'));
  await writeFile(feat('files', '[key]', 'route.ts'), [
    "// Serves a stored file back by key. getFileStore().get(key) returns the bytes",
    "// as a web ReadableStream (streamed, never buffered whole) plus the recorded",
    "// content type. The key is validated inside the store (traversal-safe).",
    "import { getFileStore } from '@webjsdev/server';",
    "",
    "export async function GET(_req: Request, { params }: { params: { key: string } }) {",
    "  const file = await getFileStore().get(params.key);",
    "  if (!file) return new Response('Not found', { status: 404 });",
    "  return new Response(file.body as ReadableStream<Uint8Array>, {",
    "    headers: { 'content-type': file.contentType, 'content-length': String(file.size) },",
    "  });",
    "}",
    "",
  ].join('\n'));

  // 5) WebSocket endpoint with broadcast fan-out.
  await mkdir(feat('ws'), { recursive: true });
  await writeFile(feat('ws', 'route.ts'), [
    "// API backend-features demo. Keep and adapt it, or prune it (delete this app/api/features/ws route).",
    "// A WebSocket endpoint: exporting WS(ws, req) upgrades this route to a socket.",
    "// The framework auto-registers each connection to its path, so broadcast()",
    "// fans a message out to every connected client. Connect two clients to",
    "// ws://localhost:8080/api/features/ws and watch messages arrive in both.",
    "import { broadcast } from '@webjsdev/server';",
    "",
    "// A plain GET (a browser opening the URL) returns usage; the live socket is",
    "// the WS handler below, reached over ws:// with a WebSocket client.",
    "export async function GET(req: Request) {",
    "  const base = new URL(req.url).origin.replace(/^http/, 'ws');",
    "  return Response.json({",
    "    protocol: 'WebSocket',",
    "    usage: 'Connect over ws:// and send a message; it is broadcast to every connected client.',",
    "    url: base + '/api/features/ws',",
    "  });",
    "}",
    "",
    "type WSLike = {",
    "  on(event: 'message' | 'close', cb: (data: Buffer) => void): void;",
    "  send(msg: string): void;",
    "};",
    "",
    "export function WS(ws: WSLike) {",
    "  ws.on('message', (data) => {",
    "    broadcast('/api/features/ws', data.toString());",
    "  });",
    "}",
    "",
  ].join('\n'));

  // 6) Boot-time env validation (opt-in). env.ts lives at the app ROOT (sibling
  // to middleware.ts), not inside app/. All-optional so it never blocks boot.
  await writeFile(join(appDir, 'env.ts'), [
    "// Boot-time env validation (opt-in, app-root env.ts). A schema of var name to",
    "// type/options; webjs coerces values, applies defaults, and fails fast naming",
    "// EVERY bad var. Kept all-optional here so it never blocks a fresh boot; make",
    "// a var required by dropping `optional`.",
    "export default {",
    "  DATABASE_URL: { type: 'string', optional: true },",
    "  PORT: { type: 'number', optional: true, default: 8080 },",
    "  NODE_ENV: { type: 'enum', values: ['development', 'production', 'test'], optional: true },",
    "};",
    "",
  ].join('\n'));

  // A starter test for the validated action.
  await writeFile(join(appDir, 'test', 'unit', 'widgets.test.ts'), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "",
    "import { createWidget } from '#modules/widgets/actions/create-widget.server.ts';",
    "",
    "test('createWidget echoes the name and mints an id', async () => {",
    "  const w = await createWidget({ name: 'Gadget' });",
    "  assert.equal(w.name, 'Gadget');",
    "  assert.ok(w.id);",
    "});",
    "",
  ].join('\n'));
}
