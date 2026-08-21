/**
 * Compile-time type fixture for the `@webjsdev/server` public surface (#310).
 *
 * NOT executed by node:test directly. The runner `server-types.test.mjs`
 * consumes it via `tsc --noEmit` under `strict` + `nodenext` (the same
 * resolution a scaffolded app uses), so a missing or wrong declaration is a
 * build failure here. The headline acceptance is that the bare server import
 * resolves a declaration instead of emitting TS7016.
 *
 * Each `// @ts-expect-error` line is a self-checking counterfactual: tsc reports
 * an "unused @ts-expect-error" if the type ever widens to accept the bad value.
 */

import {
  createRequestHandler,
  startServer,
  cors,
  cache,
  createAuth,
  rateLimit,
  sitemap,
  sitemapIndex,
  Session,
  json,
  readBody,
  revalidatePath,
  revalidateTag,
  broadcast,
  headers,
  cookies,
  getRequest,
  requestId,
  memoryStore,
  redisStore,
  getStore,
  setStore,
  defaultLogger,
  validateEnv,
  diskStore,
  getFileStore,
  setFileStore,
  generateKey,
  signedUrl,
  verifySignedUrl,
} from '@webjsdev/server';
import type { FileStore } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';
import { checkConventions } from '@webjsdev/server/check';

// createRequestHandler resolves to the documented handler shape. `handle` may
// answer synchronously, so its return is `Promise<Response> | Response`, the
// same union `Handle` declares. Narrowing it to `Promise<Response>` here used to
// pass only because `RequestHandler.handle` referenced a `Handle` that was never
// imported, making it an error type that absorbed the mismatch (#1451).
const app: Promise<{ handle: (r: Request) => Promise<Response> | Response }> =
  createRequestHandler({ appDir: '.' });

// startServer takes options + a port and resolves to a server handle.
async function boot() {
  const srv = await startServer({ appDir: '.', port: 3000 });
  await srv.close();
}

// sitemap / sitemapIndex are pure string serializers.
const xml: string = sitemap([{ url: 'https://x.com', priority: 0.5 }]);
const xml2: string = sitemapIndex([{ url: 'https://x.com/s.xml' }]);

// cors / rateLimit return middleware.
const corsMw = cors({ origin: ['https://app.example.com'], credentials: true });
const rlMw = rateLimit({ window: '1m', max: 60 });

// cache preserves the wrapped function signature + adds .invalidate().
const getPost = cache(async (id: string) => ({ id }), { key: 'post', ttl: 60, tags: (id) => ['post:' + id] });
async function useCache() {
  const post = await getPost('5');
  const _id: string = post.id;
  await getPost.invalidate();
  void _id;
}

// The store / cache-invalidation surface.
const store = memoryStore();
setStore(store);
async function invalidate() {
  await revalidatePath('/blog');
  await revalidateTag('post:5');
}

// Auth factory.
const authInst = createAuth({ secret: 's', providers: [] });

// Session class.
function useSession(s: Session) {
  const v = s.get<string>('userId');
  s.set('userId', 'x');
  void v;
}

// Testing helpers consume a handle.
async function useTesting(handle: (r: Request) => Promise<Response>) {
  const res = await testRequest(handle, '/about');
  const _ok: boolean = res.ok;
  void _ok;
}

// checkConventions returns violations.
async function check() {
  const violations = await checkConventions('.');
  const _rule: string = violations[0]?.rule ?? '';
  void _rule;
}

// @ts-expect-error appDir is required.
createRequestHandler({});

// @ts-expect-error sitemap takes an array of entries, not a bare string.
sitemap('not-an-array');

// File storage (#247): the store surface + helpers resolve real types.
const fileStore: FileStore = diskStore({ dir: '/tmp/up', baseUrl: '/files' });
const sameStore: FileStore = getFileStore();
setFileStore(fileStore);
const fileKey: string = generateKey('photo.png');
const signed: string = signedUrl(fileKey, { secret: 's', expiresIn: 60 });
const verified: { valid: boolean; key: string | null } = verifySignedUrl(signed, 's');
async function useFileStore() {
  const put = await fileStore.put(fileKey, new Blob(['x']));
  const _size: number = put.size;
  const handle = await fileStore.get(fileKey);
  const _ct: string | undefined = handle?.contentType;
  const _u: string = fileStore.url(fileKey);
  void _size;
  void _ct;
  void _u;
}
// @ts-expect-error signedUrl requires a secret in its options.
signedUrl('k', { expiresIn: 60 });

void boot;
void app;
void xml;
void xml2;
void corsMw;
void rlMw;
void useCache;
void invalidate;
void getStore;
void redisStore;
void json;
void readBody;
void broadcast;
void headers;
void cookies;
void getRequest;
void requestId;
void defaultLogger;
void validateEnv;
void authInst;
void useSession;
void useTesting;
void check;
void sameStore;
void verified;
void useFileStore;
