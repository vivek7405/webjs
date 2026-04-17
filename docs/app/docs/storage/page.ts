import { html } from 'webjs';

export const metadata = { title: 'File Storage — webjs' };

export default function Storage() {
  return html`
    <h1>File Storage</h1>
    <p>webjs provides a pluggable file storage abstraction that follows the <strong>convention over configuration</strong> philosophy: local disk storage in development, automatic switch to S3-compatible object storage in production. No config files, no adapter registration.</p>

    <h2>Zero-Config Convention</h2>
    <pre># Development — nothing to configure
# webjs uses diskStorage automatically (writes to ./uploads/)

# Production — set one env var
S3_BUCKET=my-app-uploads</pre>

    <p>Without <code>S3_BUCKET</code>, files are stored on the local filesystem in a <code>./uploads/</code> directory. Set <code>S3_BUCKET</code> and webjs switches to S3-compatible object storage. AWS credentials are read from the standard <code>AWS_ACCESS_KEY_ID</code> / <code>AWS_SECRET_ACCESS_KEY</code> environment variables (or IAM roles when running on AWS infrastructure).</p>

    <h2>Backends</h2>
    <h3>diskStorage (default)</h3>
    <p>Stores files on the local filesystem under <code>./uploads/</code>. Files are served directly by the webjs static file handler. Perfect for development and single-server deployments.</p>
    <ul>
      <li>Zero dependencies — uses Node's built-in <code>fs</code> module.</li>
      <li>Files survive restarts (unlike memory-based stores).</li>
      <li>Not suitable for multi-instance deployments (each instance has its own disk).</li>
    </ul>

    <h3>s3Storage (production)</h3>
    <p>Stores files in an S3-compatible bucket (AWS S3, DigitalOcean Spaces, Cloudflare R2, MinIO). Activated automatically when <code>S3_BUCKET</code> is present.</p>
    <ul>
      <li>Works with any S3-compatible provider.</li>
      <li>Supports multi-instance deployments — all instances share the same bucket.</li>
      <li>Set <code>S3_ENDPOINT</code> for non-AWS providers.</li>
    </ul>

    <pre># AWS S3
S3_BUCKET=my-app-uploads

# DigitalOcean Spaces
S3_BUCKET=my-space
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com

# Cloudflare R2
S3_BUCKET=my-bucket
S3_ENDPOINT=https://&lt;account-id&gt;.r2.cloudflarestorage.com</pre>

    <h2>API</h2>
    <pre>import { storage } from '@webjs/server';</pre>

    <h3>storage.put(key, data, options?)</h3>
    <p>Stores a file. The key is the file path/name. Data can be a Buffer, ReadableStream, or string.</p>

    <pre>await storage.put('avatars/user-42.jpg', fileBuffer, {
  contentType: 'image/jpeg',
});</pre>

    <h3>storage.get(key)</h3>
    <p>Retrieves a file. Returns a <code>{ data, contentType }</code> object, or <code>null</code> if the file does not exist.</p>

    <pre>const file = await storage.get('avatars/user-42.jpg');
if (file) {
  // file.data — ReadableStream
  // file.contentType — 'image/jpeg'
}</pre>

    <h3>storage.delete(key)</h3>
    <p>Deletes a file from storage.</p>

    <pre>await storage.delete('avatars/user-42.jpg');</pre>

    <h3>storage.url(key)</h3>
    <p>Returns a public URL for the file. In disk mode, this is a path like <code>/uploads/avatars/user-42.jpg</code>. In S3 mode, this is a pre-signed URL or a public bucket URL, depending on your bucket policy.</p>

    <pre>const avatarUrl = await storage.url('avatars/user-42.jpg');
// diskStorage:  '/uploads/avatars/user-42.jpg'
// s3Storage:    'https://my-bucket.s3.amazonaws.com/avatars/user-42.jpg'</pre>

    <h2>Example: Avatar Upload in a Server Action</h2>
    <pre>// app/actions/avatar.server.js
'use server';
import { storage } from '@webjs/server';
import { getSession } from '@webjs/server';
import { prisma } from '../lib/db.server.js';

export async function uploadAvatar(req) {
  const session = await getSession(req);
  if (!session.userId) throw new Error('Not authenticated');

  const formData = await req.formData();
  const file = formData.get('avatar');

  if (!file || !file.size) {
    throw new Error('No file uploaded');
  }

  // Validate file type
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    throw new Error('Invalid file type. Upload JPEG, PNG, or WebP.');
  }

  // Store the file
  const key = \`avatars/\${session.userId}-\${Date.now()}.jpg\`;
  await storage.put(key, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
  });

  // Get the public URL and save to the database
  const url = await storage.url(key);
  await prisma.user.update({
    where: { id: session.userId },
    data: { avatarUrl: url },
  });

  return { avatarUrl: url };
}</pre>

    <h2>Example: File Download API Route</h2>
    <pre>// app/api/files/[key]/route.server.js
import { storage } from '@webjs/server';

export async function GET(req) {
  const { key } = req.params;
  const file = await storage.get(\`documents/\${key}\`);

  if (!file) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(file.data, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': \`attachment; filename="\${key}"\`,
    },
  });
}</pre>

    <h2>Example: Cleaning Up Old Files</h2>
    <pre>// jobs/cleanup-orphaned-files.server.js
import { defineJob } from '@webjs/server';
import { storage } from '@webjs/server';
import { prisma } from '../lib/db.server.js';

export const cleanupFilesJob = defineJob('cleanup-files', async () => {
  // Find users who changed their avatar (old URL no longer matches)
  const orphaned = await prisma.uploadLog.findMany({
    where: { orphaned: true },
  });

  for (const record of orphaned) {
    await storage.delete(record.key);
    await prisma.uploadLog.delete({ where: { id: record.id } });
  }
});</pre>

    <h2>Explicit Backend Selection</h2>
    <p>To override auto-detection (for example, testing S3 integration locally with MinIO):</p>

    <pre>// webjs.config.js
import { s3Storage } from '@webjs/server';

export default {
  storage: s3Storage({
    bucket: 'test-bucket',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true, // required for MinIO
  }),
};</pre>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/server-actions">Server Actions</a> — handle file uploads from client components</li>
      <li><a href="/docs/api-routes">API Routes</a> — build file download endpoints</li>
      <li><a href="/docs/jobs">Background Jobs</a> — schedule file cleanup tasks</li>
    </ul>
  `;
}
