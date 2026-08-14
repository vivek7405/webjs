import { checkNodeInline } from '../../node-preflight.js';
import { readEngines } from '../util.js';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 1, Node version. HARD-FAIL when the running major is below the required
 * major (the strip-types + recursive fs.watch floor). `opts.nodeVersion` lets a
 * test inject the running version so the fail case is assertable without being
 * on old Node.
 * @param {string} cliDir
 * @param {{ nodeVersion?: string }} opts
 * @returns {Promise<DoctorResult>}
 */
export async function checkNode(cliDir, opts) {
  const engines = await readEngines(cliDir);
  const current = opts.nodeVersion || process.versions.node;
  const r = checkNodeInline(current, engines);
  if (r.ok) {
    return {
      name: 'node-version',
      status: 'pass',
      message: `Node ${r.current} satisfies the required Node ${r.requiredMajor}+.`,
    };
  }
  return {
    name: 'node-version',
    status: 'fail',
    message:
      `Node ${r.current} is below the required Node ${r.requiredMajor}+. ` +
      `webjs is buildless and relies on Node ${r.requiredMajor}'s built-in TypeScript ` +
      `strip and recursive fs.watch.`,
    fix: `Upgrade to Node ${r.requiredMajor}+ (see https://nodejs.org).`,
  };
}
