/**
 * Convention validator for WebJs apps.
 *
 * Scans an app directory and reports correctness violations: things that
 * crash the app, leak a secret, or fail the build / type-strip. Designed to be
 * run by AI agents, CI pipelines, or `webjs check` to catch real breakage
 * early. Every rule is unconditional (no per-project disabling): project
 * conventions (layout, style, process) are guidance in CONVENTIONS.md, not
 * rules in this tool.
 *
 * **How AI agents should use the output:**
 * Each violation includes a machine-readable `rule` identifier, the offending
 * `file` (relative to appDir), a human-readable `message`, and a suggested
 * `fix`. Agents should iterate the array and apply (or propose) the fixes.
 *
 * @module check
 *
 * Public API barrel re-exporting sub-modules under `./check/*`.
 *
 * @module check
 */

export { RULES } from './check/rules.js';
export { checkConventions } from './check/runner.js';
