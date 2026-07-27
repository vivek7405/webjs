import { loadRegistryIndex } from '#modules/ui/queries/registry.server.ts';
import { REGISTRY_HEADERS } from '#modules/ui/utils/registry-headers.ts';

/**
 * GET /ui/registry/index.json: the flat item list, metadata only, which is
 * what `webjs ui list` reads.
 */
export async function GET() {
  const items = await loadRegistryIndex();
  return new Response(JSON.stringify(items, null, 2), { headers: REGISTRY_HEADERS });
}
