/**
 * Pluggable file storage — local disk for development, S3-compatible for
 * production. Convention over configuration.
 *
 * Convention over configuration:
 *   - `S3_BUCKET` env var → S3 storage (production, multi-instance)
 *   - Otherwise → local disk storage in `./uploads/`
 *
 * ```js
 * import { getStorage } from '@webjs/server';
 *
 * export async function POST(req) {
 *   const form = await req.formData();
 *   const file = form.get('avatar');
 *   const key = `avatars/${crypto.randomUUID()}`;
 *   await getStorage().put(key, file.stream(), {
 *     contentType: file.type,
 *   });
 *   return Response.json({ url: getStorage().url(key) });
 * }
 *
 * // Reading back:
 * const stream = await getStorage().get('avatars/abc123');
 * ```
 *
 * For disk storage, files are served at `/__webjs/uploads/<key>`.
 * For S3, `url()` returns the S3 object URL.
 *
 * @module storage
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';

/**
 * @typedef {Object} Storage
 * @property {(key: string, data: Buffer | ReadableStream | string, opts?: { contentType?: string }) => Promise<string>} put
 *   Store data under `key`. Returns the key.
 * @property {(key: string) => Promise<ReadableStream | null>} get
 *   Retrieve data by key. Returns a ReadableStream or null if not found.
 * @property {(key: string) => Promise<void>} delete
 *   Delete data by key.
 * @property {(key: string) => string} url
 *   Get the public URL for a stored file.
 */

// ---------------------------------------------------------------------------
// Disk storage
// ---------------------------------------------------------------------------

/**
 * Local filesystem storage. Files are written to a directory on disk
 * (defaults to `./uploads/`). Served via `/__webjs/uploads/<key>`.
 *
 * Zero dependencies, great for development and single-server deployments.
 *
 * @param {{ dir?: string, urlPrefix?: string }} [opts]
 * @returns {Storage}
 */
export function diskStorage(opts = {}) {
  const dir = opts.dir || join(process.cwd(), 'uploads');
  const urlPrefix = opts.urlPrefix || '/__webjs/uploads';

  /**
   * Ensure the directory for a file path exists.
   * @param {string} filePath
   */
  async function ensureDir(filePath) {
    await mkdir(dirname(filePath), { recursive: true });
  }

  /**
   * Convert various input types to a Node.js Readable stream.
   * @param {Buffer | ReadableStream | string} data
   * @returns {import('node:stream').Readable}
   */
  function toReadable(data) {
    if (Buffer.isBuffer(data)) return Readable.from(data);
    if (typeof data === 'string') return Readable.from(Buffer.from(data, 'utf8'));
    // ReadableStream (web) → Node Readable
    if (typeof data.getReader === 'function') return Readable.fromWeb(/** @type {any} */ (data));
    return Readable.from(data);
  }

  return {
    async put(key, data, _putOpts = {}) {
      const filePath = join(dir, key);
      await ensureDir(filePath);

      const readable = toReadable(data);
      const writable = createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        readable.pipe(writable);
        writable.on('finish', resolve);
        writable.on('error', reject);
        readable.on('error', reject);
      });

      return key;
    },

    async get(key) {
      const filePath = join(dir, key);
      try {
        await stat(filePath);
      } catch {
        return null;
      }
      const nodeStream = createReadStream(filePath);
      // Convert Node Readable to web ReadableStream
      return /** @type {ReadableStream} */ (Readable.toWeb(nodeStream));
    },

    async delete(key) {
      const filePath = join(dir, key);
      try {
        await unlink(filePath);
      } catch (err) {
        // Ignore ENOENT — file already gone
        if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
      }
    },

    url(key) {
      return `${urlPrefix}/${key}`;
    },
  };
}

// ---------------------------------------------------------------------------
// S3 storage
// ---------------------------------------------------------------------------

/**
 * AWS S3-compatible storage. Works with AWS S3, MinIO, R2, DigitalOcean
 * Spaces, and any S3-compatible provider.
 *
 * Requires `@aws-sdk/client-s3` to be installed. Reads credentials from
 * the standard AWS environment variables (`AWS_ACCESS_KEY_ID`,
 * `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) or from the SDK's default
 * credential chain.
 *
 * @param {{
 *   bucket?: string,
 *   region?: string,
 *   endpoint?: string,
 *   prefix?: string,
 *   urlBase?: string,
 * }} [opts]
 * @returns {Storage}
 */
export function s3Storage(opts = {}) {
  const bucket = opts.bucket || process.env.S3_BUCKET;
  if (!bucket) throw new Error('s3Storage requires S3_BUCKET environment variable or opts.bucket');

  const region = opts.region || process.env.AWS_REGION || 'us-east-1';
  const endpoint = opts.endpoint || process.env.S3_ENDPOINT || undefined;
  const prefix = opts.prefix || '';
  const urlBase = opts.urlBase || process.env.S3_URL_BASE || undefined;

  /** @type {any} */
  let s3Client = null;
  /** @type {Promise<any> | null} */
  let connecting = null;

  async function getClient() {
    if (s3Client) return s3Client;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const { S3Client } = await import('@aws-sdk/client-s3');
        /** @type {any} */
        const clientOpts = { region };
        if (endpoint) {
          clientOpts.endpoint = endpoint;
          clientOpts.forcePathStyle = true; // MinIO / local S3
        }
        s3Client = new S3Client(clientOpts);
        return s3Client;
      } catch {
        throw new Error('Install @aws-sdk/client-s3: npm install @aws-sdk/client-s3');
      }
    })();
    return connecting;
  }

  /**
   * Full S3 key including optional prefix.
   * @param {string} key
   * @returns {string}
   */
  function fullKey(key) {
    return prefix ? `${prefix}/${key}` : key;
  }

  return {
    async put(key, data, putOpts = {}) {
      const client = await getClient();
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');

      /** @type {any} */
      let body;
      if (Buffer.isBuffer(data)) {
        body = data;
      } else if (typeof data === 'string') {
        body = Buffer.from(data, 'utf8');
      } else if (typeof /** @type {any} */ (data).getReader === 'function') {
        // Web ReadableStream → collect to Buffer for S3
        const reader = /** @type {ReadableStream} */ (data).getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        body = Buffer.concat(chunks);
      } else {
        body = data;
      }

      /** @type {any} */
      const params = {
        Bucket: bucket,
        Key: fullKey(key),
        Body: body,
      };
      if (putOpts.contentType) params.ContentType = putOpts.contentType;

      await client.send(new PutObjectCommand(params));
      return key;
    },

    async get(key) {
      const client = await getClient();
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');

      try {
        const resp = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) }),
        );
        if (!resp.Body) return null;
        // AWS SDK v3 Body is a web ReadableStream or Node stream depending on runtime
        if (typeof resp.Body.transformToWebStream === 'function') {
          return resp.Body.transformToWebStream();
        }
        // Fallback: convert Node Readable
        if (typeof resp.Body.pipe === 'function') {
          return /** @type {ReadableStream} */ (Readable.toWeb(resp.Body));
        }
        return null;
      } catch (err) {
        if (/** @type {any} */ (err).name === 'NoSuchKey') return null;
        throw err;
      }
    },

    async delete(key) {
      const client = await getClient();
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(key) }),
      );
    },

    url(key) {
      if (urlBase) return `${urlBase}/${fullKey(key)}`;
      if (endpoint) return `${endpoint}/${bucket}/${fullKey(key)}`;
      return `https://${bucket}.s3.${region}.amazonaws.com/${fullKey(key)}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-detect
// ---------------------------------------------------------------------------

/**
 * Auto-detect the best storage backend based on environment.
 * `S3_BUCKET` → S3 storage, otherwise → local disk.
 *
 * @returns {Storage}
 */
export function autoStorage() {
  if (process.env.S3_BUCKET) return s3Storage();
  return diskStorage();
}

// ---------------------------------------------------------------------------
// Global default
// ---------------------------------------------------------------------------

/** @type {Storage | null} */
let _default = null;

/**
 * Get the default storage backend (auto-detected on first call).
 * @returns {Storage}
 */
export function getStorage() {
  if (!_default) _default = autoStorage();
  return _default;
}

/**
 * Override the default storage backend.
 * @param {Storage} s
 */
export function setStorage(s) {
  _default = s;
}
