import { html } from '@webjsdev/core';

export const metadata = { title: 'File Storage | WebJs' };

export default function FileStorage() {
  return html`
    <h1>File Storage</h1>
    <p>WebJs ships a pluggable file-storage primitive for uploaded <code>File</code> / <code>Blob</code> payloads. It mirrors the cache and session adapters: a documented <code>FileStore</code> interface, a default on-disk adapter (<code>diskStore</code>), and a module singleton (<code>getFileStore</code> / <code>setFileStore</code>) so an app swaps the backend in one call without touching any call site. The default lands bytes on local disk, and the same shape is S3-pluggable for production.</p>

    <pre>import { getFileStore, setFileStore, diskStore, generateKey, signedUrl, verifySignedUrl } from '@webjsdev/server';</pre>

    <h2>The FileStore interface</h2>
    <p>Every method operates on web-standard objects, so an S3-compatible adapter is a drop-in (see below).</p>

    <table>
      <thead>
        <tr><th>Method</th><th>Shape</th></tr>
      </thead>
      <tbody>
        <tr><td><code>put(key, file, opts?)</code></td><td>Stream a <code>File</code> / <code>Blob</code> / <code>ReadableStream</code> / <code>Uint8Array</code> to storage. Returns <code>{ key, size, contentType }</code>.</td></tr>
        <tr><td><code>get(key)</code></td><td>Returns <code>{ body, size, contentType }</code> (a STREAMING handle) or <code>null</code>. The serving route does <code>new Response(handle.body, { headers })</code>.</td></tr>
        <tr><td><code>delete(key)</code></td><td>Remove the object. Idempotent (a missing key is not an error).</td></tr>
        <tr><td><code>url(key)</code></td><td>The served URL (<code>&lt;baseUrl&gt;/&lt;key&gt;</code> for <code>diskStore</code>).</td></tr>
        <tr><td><code>has(key)</code></td><td>Whether the key exists (optional).</td></tr>
      </tbody>
    </table>

    <p><code>get()</code> returns a STREAMING handle (<code>body</code> is a stream), not a <code>Blob</code>, so a serving route streams the file to the client without reading it into memory. The write path is streaming too, so a large upload uses constant memory. The upstream body-size cap (<code>maxMultipartBytes</code>, default 10 MiB) bounds the upload before the bytes reach the store, so the store does not re-implement that limit, it only stays streaming.</p>

    <h2>Reading and swapping the active store</h2>
    <p>Read the active store with <code>getFileStore()</code>, swap it once at startup with <code>setFileStore(store)</code>. Every call site reads through <code>getFileStore()</code>, so a single <code>setFileStore</code> call changes the backend everywhere.</p>

    <pre>import { getFileStore } from '@webjsdev/server';

const { key, size, contentType } = await getFileStore().put(generateKey(file.name), file);</pre>

    <h2>diskStore (the default adapter)</h2>
    <p>The default store is a <code>diskStore</code> rooted at <code>&lt;cwd&gt;/.webjs/uploads</code>, served under <code>/uploads</code>. Override the root and base URL at startup:</p>

    <pre>import { setFileStore, diskStore } from '@webjsdev/server';

setFileStore(diskStore({ dir: '/var/data/uploads', baseUrl: '/files' }));</pre>

    <p>Add the uploads directory to <code>.gitignore</code>, because it holds user data, not source.</p>

    <h2>Traversal-safe keys</h2>
    <p>Every key is resolved to an absolute path under <code>dir</code> and rejected if it escapes, using the same containment guard the <code>/public/*</code> serve path uses. A key with <code>..</code>, an absolute path, a leading slash, a NUL byte, a backslash, or the reserved <code>.meta</code> suffix throws (<code>assertSafeKey</code>) before any filesystem operation. Never trust a user-supplied filename as a key. Use <code>generateKey</code>:</p>

    <pre>const key = generateKey(file.name);   // &lt;uuid&gt;.&lt;ext&gt;, opaque + safe</pre>

    <p><code>generateKey(filename?)</code> returns a random <code>crypto.randomUUID()</code> key, preserving only a whitelisted, sanitized extension from the original filename. A malicious <code>'../../x.sh'</code> yields a bare opaque key with no path and no unsafe extension.</p>

    <h2>Signed URLs (gated serving)</h2>
    <p><code>signedUrl</code> / <code>verifySignedUrl</code> mint and verify an expiring HMAC-SHA256 (base64url) signature over the exact key plus its expiry, so a serving route can gate access without a session lookup. Neither the key nor the expiry can be tampered with (both are signed), and the comparison is constant-time.</p>

    <pre>const url = signedUrl(key, { secret: process.env.AUTH_SECRET, expiresIn: 3600 });

// in the serving route:
const check = verifySignedUrl(new URL(request.url).searchParams, process.env.AUTH_SECRET);
if (!check.valid) return new Response('Forbidden', { status: 403 });</pre>

    <p>An explicit <code>expiresIn</code> of <code>0</code> or a negative number fails CLOSED (the minted URL is already expired), so a "no access" intent never silently becomes a 1-hour grant. The 1-hour default applies only when <code>expiresIn</code> is omitted.</p>

    <h2>Recipe: upload, persist, and serve back</h2>
    <p>A file upload is a <code>&lt;form enctype="multipart/form-data"&gt;</code> posting to a page <code>action</code>. With JS disabled it is a native round-trip, with JS the client router upgrades it in place. No upload library, no <code>fetch</code>. The bytes are streamed to storage via <code>getFileStore()</code>, never buffered whole.</p>

    <pre>// app/avatar/page.ts
import { html } from '@webjsdev/core';
import { saveAvatar } from '#modules/avatar/actions/save-avatar.server.ts';

export async function action({ formData }: { formData: FormData }) {
  const file = formData.get('avatar');               // a web File
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, fieldErrors: { avatar: 'Choose an image' }, status: 422 };
  }
  const result = await saveAvatar(file);             // persists + returns the key
  if (!result.success) return result;
  return { success: true, redirect: '/avatar' };
}

export default function Avatar({ actionData }: {
  actionData?: { fieldErrors?: Record&lt;string, string&gt; };
}) {
  const errors = actionData?.fieldErrors || {};
  return html\`
    &lt;form method="POST" enctype="multipart/form-data" class="flex flex-col gap-3"&gt;
      &lt;input name="avatar" type="file" accept="image/*" required&gt;
      \${errors.avatar ? html\`&lt;p class="text-sm text-red-600"&gt;\${errors.avatar}&lt;/p&gt;\` : ''}
      &lt;button type="submit"&gt;Upload&lt;/button&gt;
    &lt;/form&gt;
  \`;
}</pre>

    <p>The page <code>action</code> delegates to a <code>'use server'</code> action that streams the file to storage with a generated, traversal-safe key and persists that key on the DB row.</p>

    <pre>// modules/avatar/actions/save-avatar.server.ts
'use server';
import { getFileStore, generateKey } from '@webjsdev/server';
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';

export async function saveAvatar(file: File) {
  const key = generateKey(file.name);                // &lt;uuid&gt;.&lt;ext&gt;, safe
  const { size, contentType } = await getFileStore().put(key, file); // streams to disk
  if (size &gt; 5 * 1024 * 1024) {                      // app-level policy check
    await getFileStore().delete(key);
    return { success: false, fieldErrors: { avatar: 'Max 5 MB' }, status: 422 };
  }
  await db.update(users).set({ avatarKey: key }).where(eq(users.id, 'me'));
  return { success: true, data: { key, contentType } };
}</pre>

    <p>Serve the stored file from a <code>route.ts</code>, streaming <code>get(key)</code> and gating it behind a signed URL so the object is not world-readable by key alone.</p>

    <pre>// app/files/[key]/route.ts
import { getFileStore, verifySignedUrl } from '@webjsdev/server';

export async function GET(request: Request, { params }: { params: { key: string } }) {
  const check = verifySignedUrl(new URL(request.url).searchParams, process.env.AUTH_SECRET!);
  if (!check.valid || check.key !== params.key) {
    return new Response('Forbidden', { status: 403 });
  }
  const handle = await getFileStore().get(params.key);
  if (!handle) return new Response('Not Found', { status: 404 });
  return new Response(handle.body, {            // streams, never reads the file into memory
    headers: {
      'content-type': handle.contentType,
      'content-length': String(handle.size),
      'x-content-type-options': 'nosniff',
      'content-disposition': 'attachment',
    },
  });
}</pre>

    <p>Mint the signed URL where you render the link (a page or component):</p>

    <pre>import { signedUrl } from '@webjsdev/server';

const href = signedUrl(user.avatarKey, { secret: process.env.AUTH_SECRET!, expiresIn: 3600 });</pre>

    <h2>Serving user uploads safely</h2>
    <p>The content-type a store records is the one the BROWSER sent at upload time, so it is attacker-controlled. A serving route that reflects it inline lets an attacker run script in your origin (stored XSS) by uploading HTML or <code>image/svg+xml</code> tagged <code>text/html</code> under an innocent-looking key. The serving route MUST send <code>X-Content-Type-Options: nosniff</code>, and SHOULD send <code>Content-Disposition: attachment</code> for anything a user uploaded (the recipe above does both). Only serve a user upload inline when you have validated the bytes server-side and emit a content-type from a strict inert allowlist (<code>image/png</code>, <code>image/jpeg</code>), never <code>text/html</code> / <code>image/svg+xml</code>. Serving uploads from a separate cookieless origin is the strongest mitigation.</p>

    <h2>File, Blob, and FormData round-trip the action serializer</h2>
    <p>A native <code>File</code>, <code>Blob</code>, or <code>FormData</code> passes through the server-action wire intact, so the same <code>saveAvatar(file)</code> call works whether it runs during SSR (the real function) or from a client component (an RPC stub). You never hand-write a multipart <code>fetch</code>. See <a href="/docs/server-actions">Server Actions</a> for the full list of rich types the wire round-trips.</p>

    <h2>S3-pluggability</h2>
    <p>The interface operates on web-standard objects only, so an S3 / R2 / GCS / MinIO adapter is a drop-in. It implements the same <code>put</code> (PutObject, streaming the body), <code>get</code> (GetObject, returning the SDK's response stream as <code>body</code>), <code>delete</code> (DeleteObject), and <code>url</code> (the object / CDN URL). Because the shape is identical, <code>setFileStore(s3Store({ ... }))</code> switches the whole app with no call-site change. WebJs ships no S3 SDK (no new dependency), so the adapter is a thin wrapper an app provides.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/server-actions">Server Actions</a>: the RPC boundary that round-trips File / Blob / FormData</li>
      <li><a href="/docs/route-handlers">Route Handlers</a>: the route.ts that streams stored bytes back</li>
      <li><a href="/docs/caching">Caching</a>: the cache adapter the file store's swap-the-backend model mirrors</li>
    </ul>
  `;
}
