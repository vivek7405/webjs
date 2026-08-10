/**
 * Provider names accepted by `webjs vendor pin --from <provider>`.
 */
export const SUPPORTED_PROVIDERS = new Set(['jspm', 'jsdelivr', 'unpkg', 'skypack']);

/**
 * Normalize user-facing provider name for jspm.io API.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeProvider(name) {
  return name === 'jspm' ? 'jspm.io' : name;
}
