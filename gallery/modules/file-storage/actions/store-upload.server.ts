'use server';

// The directive comes FIRST, ahead of this header: the framework reads it from
// the file's first few lines, so a long comment block above it would push it
// out of range and the file would not register as an action at all.
//
// The action the upload <form> is bound to. 'use server' means it never
// crashes the browser module that imports it (the client gets a safe RPC stub,
// not the node:fs code). getFileStore() is the pluggable storage singleton: a
// local diskStore rooted at <cwd>/.webjs/uploads by default (gitignored),
// swappable for S3/R2/GCS with one setFileStore() call at boot. generateKey()
// mints a collision-free, traversal-safe key preserving a whitelisted
// extension.
//
// It takes the FormData, which is what a form-bound action always receives, and
// pulls the File out of it. The framework emits the multipart enctype the
// upload needs, so a bound form carries a file with no extra attribute.
import { getFileStore, generateKey } from '@webjsdev/server';
// Importing the config module runs setFileStore(diskStore(...)) once at load,
// so uploads land in the configured store. See ../store.server.ts.
import '../store.server.ts';

export async function storeUpload(formData: FormData) {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { success: false as const, error: 'Choose a file to upload.' };
  }
  const key = generateKey(file.name);
  const { size, contentType } = await getFileStore().put(key, file, { contentType: file.type });
  const q = new URLSearchParams({ key, name: file.name, size: String(size) });
  return { success: true as const, redirect: '/features/file-storage?' + q.toString(), data: { key, name: file.name, size, contentType } };
}
