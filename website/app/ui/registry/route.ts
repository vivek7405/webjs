import { loadRegistryManifest } from '#modules/ui/queries/registry.server.ts';
import { REGISTRY_HEADERS } from '#modules/ui/utils/registry-headers.ts';

/**
 * GET /ui/registry: the full registry manifest, every item's content inlined.
 *
 * This is an API, not a page, and it is the reason the ui.webjs.dev host has
 * to keep answering forever: already-published @webjsdev/ui and @webjsdev/cli
 * versions fetch their components from the old origin, and a published version
 * can never be corrected after the fact. The old host now 301s here, which
 * shipped clients follow (fetch does by default, verified against the real
 * 0.3.1 and 0.3.8 tarballs).
 */
export async function GET() {
  return new Response(await loadRegistryManifest(), { headers: REGISTRY_HEADERS });
}
