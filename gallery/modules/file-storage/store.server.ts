// Server-only file-store configuration (no 'use server': a plain server
// utility, imported by the upload action and the serve route). `setFileStore()`
// swaps the active store; `diskStore()` is the built-in local-disk store
// (streaming, traversal-safe), the drop-in slot for an S3 / R2 / GCS adapter of
// the same shape. `signedUrl(key, { secret })` mints a time-limited,
// tamper-proof download URL and `verifySignedUrl(input, secret)` checks it, so a
// private file can be shared by link without making the serve route public.
import { setFileStore, diskStore, signedUrl, verifySignedUrl } from '@webjsdev/server';

// Configure the store once at module load. This mirrors the framework default
// (a local diskStore under .webjs/uploads); in production swap diskStore for an
// S3/R2 adapter with the same put/get/delete shape.
setFileStore(diskStore({ dir: '.webjs/uploads' }));

const URL_SECRET = process.env.FILE_URL_SECRET || 'dev-file-url-secret-change-me';

// A 1-hour signed link to the serve route for a given key.
export function signedDownloadUrl(key: string): string {
  return signedUrl(key, {
    secret: URL_SECRET,
    base: `/features/file-storage/file/${encodeURIComponent(key)}`,
    expiresIn: 3600,
  });
}

// True when a request's ?key&exp&sig params are a valid, unexpired signature.
export function isValidSignedRequest(url: string): boolean {
  return verifySignedUrl(url, URL_SECRET).valid;
}
