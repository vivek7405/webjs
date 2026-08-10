/**
 * Provider names accepted by `webjs vendor pin --from <provider>`.
 * Default `jspm` resolves to jspm.io. Same set Rails's importmap-rails
 * accepts (`packager.rb:normalize_provider`).
 *
 * jspm.io's Generator API itself supports multiple providers via the
 * `provider` field in the request body. We surface the same choice as
 * a CLI flag.
 *
 * @type {Set<string>}
 */
export const SUPPORTED_PROVIDERS = new Set(['jspm', 'jsdelivr', 'unpkg', 'skypack']);

/**
 * Normalize the user-facing provider name to what the jspm.io API
 * expects in its `provider` field. Mirrors importmap-rails's
 * `normalize_provider`: `jspm` is shorthand for `jspm.io`; the rest
 * pass through verbatim.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeProvider(name) {
  return name === 'jspm' ? 'jspm.io' : name;
}

/**
 * Outcome of one api.jspm.io/generate POST.
 * @typedef {Object} JspmCallResult
 * @property {boolean} ok        true when jspm returned a 2xx with a usable map
 * @property {Record<string, string>} imports  the resolved imports (empty on failure)
 * @property {boolean} transient true when the failure is worth retrying
 *           (network / timeout / 5xx / 429), false for a permanent 4xx
 *           (jspm uses 401 for "this install is unresolvable")
 */
