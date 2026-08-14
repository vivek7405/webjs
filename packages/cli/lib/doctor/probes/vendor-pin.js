/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 4, vendor pin freshness. Applies ONLY when a pin file exists. PASS/skip
 * for an unpinned app (it resolves live, which is fine in dev). BEST-EFFORT +
 * NETWORK-TOLERANT: any error (network, timeout) is a WARN "could not check",
 * never a hard fail and never a throw. PASS when all pins current, WARN listing
 * outdated packages otherwise.
 *
 * The vendor functions are injected via `opts.vendor` so a test can supply a
 * stub without a real network call; absent the override, they are dynamically
 * imported from `@webjsdev/server`.
 * @param {string} appDir
 * @param {{ vendor?: { hasVendorPin: (d: string) => boolean, findOutdated: (d: string) => Promise<Array<{ pkg: string, current: string, latest: string }>> } }} opts
 * @returns {Promise<DoctorResult>}
 */
export async function checkVendorPin(appDir, opts) {
  let vendor = opts.vendor;
  if (!vendor) {
    try {
      const mod = await import('@webjsdev/server');
      vendor = { hasVendorPin: mod.hasVendorPin, findOutdated: mod.findOutdated };
    } catch {
      return {
        name: 'vendor-pin',
        status: 'warn',
        // "Could not check", not a finding: never escalatable by a gate.
        bestEffort: true,
        message: 'Could not load the vendor toolchain to check pin freshness.',
        fix: 'Run `npm install` so @webjsdev/server is available, then re-run `webjs doctor`.',
      };
    }
  }
  let pinned = false;
  try {
    pinned = vendor.hasVendorPin(appDir);
  } catch {
    pinned = false;
  }
  if (!pinned) {
    return {
      name: 'vendor-pin',
      status: 'pass',
      message: 'No vendor pin file; the app resolves vendor imports live (fine in dev).',
    };
  }
  let outdated;
  try {
    outdated = await vendor.findOutdated(appDir);
  } catch {
    // findOutdated is built to swallow fetch errors and return [], but guard
    // anyway: a network check must NEVER throw out of doctor.
    return {
      name: 'vendor-pin',
      status: 'warn',
      bestEffort: true,
      message: 'Could not check pin freshness (network unreachable or registry error).',
      fix: 'Re-run `webjs doctor` when connectivity is back, or run `webjs vendor outdated`.',
    };
  }
  if (!Array.isArray(outdated) || outdated.length === 0) {
    return {
      name: 'vendor-pin',
      status: 'pass',
      message: 'All vendor pins are current.',
    };
  }
  const list = outdated.map((o) => `${o.pkg} (${o.current} -> ${o.latest})`).join(', ');
  return {
    name: 'vendor-pin',
    status: 'warn',
    message: `${outdated.length} pinned package(s) are outdated: ${list}.`,
    fix: 'Run `webjs vendor update` to re-pin to the latest versions.',
  };
}
