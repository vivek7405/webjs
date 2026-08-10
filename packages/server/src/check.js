/**
 * Convention validator for WebJs apps.
 *
 * Public API barrel re-exporting sub-modules under `./check/*`.
 *
 * @module check
 */

export { RULES } from './check/rules.js';
export { checkConventions } from './check/runner.js';
