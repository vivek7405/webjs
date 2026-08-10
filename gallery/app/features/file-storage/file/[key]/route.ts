// Serves a stored file back by key. getFileStore().get(key) returns the bytes as
// a web ReadableStream (streamed, never buffered whole into memory) plus the
// content type recorded at upload. A route.ts is server-only, so importing the
// storage singleton here is safe. The [key] segment is validated inside the
// store (traversal-safe), so a crafted key cannot escape the uploads directory.
import { getFileStore } from '@webjsdev/server';
import { isValidSignedRequest } from '#modules/file-storage/store.server.ts';

export async function GET(req: Request, { params }: { params: { key: string } }) {
  // If the request carries signed-URL params (?exp&sig), require them to be
  // valid: this is how a private file is shared by link. A request WITHOUT the
  // params is served normally here (the gallery demo keeps public access); drop
  // that branch to make every download require a valid signature.
  const url = new URL(req.url);
  if (url.searchParams.has('sig') && !isValidSignedRequest(req.url)) {
    return new Response('Forbidden', { status: 403 });
  }
  const file = await getFileStore().get(params.key);
  if (!file) return new Response('Not found', { status: 404 });
  // file.body is a web ReadableStream at runtime (the diskStore streams the
  // bytes); the store's type is a Node/web union, so narrow it for Response.
  return new Response(file.body as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': file.contentType,
      'content-length': String(file.size),
    },
  });
}
