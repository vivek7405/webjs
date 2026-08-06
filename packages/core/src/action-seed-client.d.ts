/** Client-side SSR action-seed consumer (#472). Inert server-side. */

/** Returned by `takeSeed` when no seed matches; distinct from any real value. */
export const SEED_MISS: unique symbol;

/**
 * Merge any seeds found under `root` (or the whole document) into the global
 * consume-once store, removing the carriers. Reads the page-level
 * `#__webjs-seeds` JSON block and per-element `[data-webjs-seed]` carriers.
 *
 * A DETACHED root means a new PAGE is arriving, which evicts whatever the
 * outgoing page left unconsumed. Pass `{ frame: true }` for a `<webjs-frame>`
 * subtree swap, which is not a page navigation and must leave page state alone.
 */
export function scanSeeds(
  root?: ParentNode,
  opts?: { frame?: boolean },
): void;

/**
 * Look up and CONSUME the seed for an action call, or return `SEED_MISS`.
 * Keyed `hash/fn/argsKey`; the first call lazily scans the initial document.
 */
export function takeSeed(hash: string, fnName: string, argsKey: string): unknown;

/**
 * The cumulative seed counters for this page session (#1309). `ingested` and
 * `replaced` are what `scanSeeds` merged; `hits` and `misses` are what the
 * generated RPC stubs asked for; `pending` is what is still unconsumed.
 */
export function seedStats(): {
  ingested: number;
  replaced: number;
  hits: number;
  misses: number;
  pending: number;
};
