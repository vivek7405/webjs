import { registryItemSchema, registryIndexSchema } from './schema.js';
import { loadRegistryItem, loadRegistryIndex } from './local.js';

/**
 * The canonical hosted registry. Local-first resolution applies ONLY for this
 * exact URL: it is the one registry whose sources ship inside the package.
 *
 * This moved from `https://ui.webjs.dev/registry` when the gallery merged into
 * the marketing site (#1099). That old URL no longer serves the registry: it
 * now redirects to the gallery PAGE, so a fetch of it follows the redirect and
 * gets HTML. Versions 0.3.1 through 0.3.8 hardcode it and hit the network, so
 * `webjsui add` is broken on those and cannot be corrected after publish.
 * Since 0.3.9 the kit resolves LOCAL-first, which is why the break stops
 * there: `add` / `list` / `view` never reach the network on this URL.
 */
export const HOSTED_REGISTRY_URL = 'https://webjs.dev/ui/registry';

/**
 * Default registry URL. A `REGISTRY_URL` env var points at a CUSTOM registry,
 * which (like an explicit `--registry`) forces the NETWORK path, since its
 * sources are not the packaged ones.
 */
export const DEFAULT_REGISTRY_URL = process.env.REGISTRY_URL || HOSTED_REGISTRY_URL;

const cache = new Map();

/**
 * True when the effective registry is the hosted one whose sources ship in the
 * package, i.e. local-first resolution applies. A custom registry (via
 * `--registry <url>` OR a `REGISTRY_URL` env override) is NOT default and forces
 * the network path, so a self-hosted registry is never silently shadowed by the
 * packaged sources.
 *
 * @param {string} [url]
 */
export function isDefaultRegistry(url) {
  const effective = url || DEFAULT_REGISTRY_URL;
  return effective === HOSTED_REGISTRY_URL;
}

/**
 * Resolve one registry item LOCAL-FIRST (#983): read the packaged registry
 * sources unless the caller pointed at a custom `--registry` URL, in which case
 * fetch over the network. This is the resolver `add` / `init` / `view` / `list`
 * use, so a scaffolded app installs components with no network dependency.
 *
 * NOTE: `webjsui diff` deliberately does NOT use this (it compares local files
 * against the LIVE upstream, so it calls {@link fetchRegistryItem} directly).
 *
 * @param {string} name
 * @param {string} [registryUrl]
 */
export async function getRegistryItem(name, registryUrl) {
  if (isDefaultRegistry(registryUrl)) {
    const item = loadRegistryItem(name);
    if (!item) {
      throw new Error(
        `Unknown registry item "${name}". Run \`webjsui list\` to see the available components.`,
      );
    }
    return item;
  }
  return fetchRegistryItem(name, registryUrl);
}

/**
 * Resolve the flat registry index LOCAL-FIRST (#983). See {@link getRegistryItem}.
 *
 * @param {string} [registryUrl]
 */
export async function getRegistryIndex(registryUrl) {
  if (isDefaultRegistry(registryUrl)) return loadRegistryIndex();
  return fetchRegistryIndex(registryUrl);
}

/**
 * Fetch a registry item by name.
 *
 * @param {string} name
 * @param {string} [baseUrl]
 */
export async function fetchRegistryItem(name, baseUrl = DEFAULT_REGISTRY_URL) {
  const url = `${baseUrl.replace(/\/$/, '')}/${name}.json`;
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch registry item "${name}" from ${url}: HTTP ${res.status}`);
  }
  const json = await res.json();
  const item = registryItemSchema.parse(json);
  cache.set(url, item);
  return item;
}

/**
 * Fetch the flat registry index (list of all items).
 *
 * @param {string} [baseUrl]
 */
export async function fetchRegistryIndex(baseUrl = DEFAULT_REGISTRY_URL) {
  const url = `${baseUrl.replace(/\/$/, '')}/index.json`;
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch registry index from ${url}: HTTP ${res.status}`);
  }
  const json = await res.json();
  const items = registryIndexSchema.parse(json);
  cache.set(url, items);
  return items;
}
