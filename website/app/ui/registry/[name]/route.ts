import {
  loadRegistryItem,
  loadRegistryIndex,
  loadRegistryManifest,
} from '#modules/ui/queries/registry.server.ts';
import { REGISTRY_HEADERS } from '#modules/ui/utils/registry-headers.ts';

/**
 * GET /ui/registry/<name>.json: one registry item.
 *
 * This is the endpoint a shipped `webjs ui add` hits (the fetcher builds
 * `<base>/<name>.json`), so its response shape is a released contract that
 * cannot change. Two reserved slugs are carried over from the old host
 * verbatim:
 *
 *   index    the flat list, same as the sibling /registry/index.json route
 *   registry the full manifest, same as /registry itself
 *
 * The `.json` suffix is stripped rather than required, because the CLI appends
 * it and a hand-written link usually does not.
 */
export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const slug = params.name.replace(/\.json$/, '');

  if (slug === 'index') {
    return new Response(JSON.stringify(await loadRegistryIndex(), null, 2), { headers: REGISTRY_HEADERS });
  }
  if (slug === 'registry') {
    return new Response(await loadRegistryManifest(), { headers: REGISTRY_HEADERS });
  }

  const item = await loadRegistryItem(slug);
  if (!item) {
    return Response.json({ error: `Registry item "${slug}" not found` }, { status: 404 });
  }
  return new Response(JSON.stringify(item, null, 2), { headers: REGISTRY_HEADERS });
}
