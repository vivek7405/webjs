/**
 * Custom-element registry rules: tag-name validity and uniqueness across the app.
 *
 * Lifted verbatim out of checkConventions, which held all twenty rules inline
 * in one 900-line function. Each rule keeps its original comment header, its
 * logic, and its position in the run order.
 */
import { join } from 'node:path';
import {
  isComponentFile,
} from './helpers.js';
import {
  gitIgnoredSet,
} from './runner-support.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */


/**
 * Rule: `tag-name-has-hyphen`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkTagNameHasHyphen(files, violations) {
  // --- Rule: tag-name-has-hyphen ---
  {
    for (const { rel, scan } of files) {
      if (!isComponentFile(rel)) continue;
      // Use redacted source. A `register('tag')` call inside a
      // TAGGED template literal (docs-page code example) is blanked.
      // Calls at top level keep their structure AND their string
      // argument. Quote style can be ', ", or ` (untagged backtick
      // literals survive the redactor, like single/double-quote
      // strings).
      const patterns = [
        // Class.register('tag') / register("tag") / register(`tag`)
        /\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*(['"`])([^'"`]+)\1/g,
        // customElements.define('tag', Class) and quote variants
        /\bcustomElements\.define\s*\(\s*(['"`])([^'"`]+)\1/g,
      ];
      for (const re of patterns) {
        let match;
        while ((match = re.exec(scan)) !== null) {
          const tagName = match[2];
          if (!tagName.includes('-')) {
            violations.push({
              rule: 'tag-name-has-hyphen',
              file: rel,
              message: `Custom element tag "${tagName}" must contain a hyphen`,
              fix: `Rename to a hyphenated tag name, e.g. "app-${tagName}" or "${tagName}-element"`,
            });
          }
        }
      }
    }
  }
}

/**
 * Rule: `no-duplicate-tag`.
 *
 * @param {string} appDir  absolute path to the app root
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {Promise<void>}
 */
export async function checkNoDuplicateTag(appDir, files, violations) {
  // --- Rule: no-duplicate-tag ---
  // Two registrations of the SAME tag string anywhere in the app resolve
  // inconsistently at runtime (SSR last-wins, browser first-wins), so flag
  // every colliding site naming the others. Scans EVERY source file, not just
  // components/, because a duplicate is a runtime hazard regardless of where
  // the register/define call lives (a page, a lib, a module can register a
  // tag too); this keeps the rule in lockstep with the editor's 9004
  // diagnostic, which is likewise project-wide. Reuses the same
  // register/define extraction as tag-name-has-hyphen, over the redacted
  // source so a tag in a docs-page tagged-template example does not count.
  // Only hyphenated tags are considered (a non-hyphenated tag is already
  // flagged by tag-name-has-hyphen / invariant 3), matching the 9004 filter.
  {
    // Generated / gitignored files (e.g. a `webjs ui add`-regenerated
    // `components/` dir) are not committed source the rule should police;
    // counting them would flag a collision between a hand-written component
    // and its generated copy. Skip anything git reports as ignored.
    // Best-effort: a non-git project (or absent git) scans everything.
    const ignored = await gitIgnoredSet(appDir, files.map((f) => f.rel));
    /** @type {Map<string, string[]>} tag -> rel files that register it (with repeats) */
    const tagSites = new Map();
    const patterns = [
      /\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*(['"`])([^'"`]+)\1/g,
      /\bcustomElements\.define\s*\(\s*(['"`])([^'"`]+)\1/g,
    ];
    for (const { scan, rel } of files) {
      if (ignored.has(rel)) continue;
      for (const re of patterns) {
        let match;
        while ((match = re.exec(scan)) !== null) {
          const tagName = match[2];
          if (!tagName.includes('-')) continue;
          const arr = tagSites.get(tagName) || [];
          arr.push(rel);
          tagSites.set(tagName, arr);
        }
      }
    }
    for (const [tagName, sites] of tagSites) {
      if (sites.length < 2) continue;
      // Report once per DISTINCT file, naming the others.
      for (const file of new Set(sites)) {
        const others = [...new Set(sites)].filter((f) => f !== file);
        const where = others.length
          ? `also registered in ${others.join(', ')}`
          : 'registered more than once in this file';
        violations.push({
          rule: 'no-duplicate-tag',
          file,
          message: `Custom element tag "${tagName}" is registered more than once (${where}). A tag must be registered exactly once; the runtime resolves a duplicate inconsistently (SSR keeps the last registration, the browser keeps the first).`,
          fix: `Rename one registration so each "${tagName}" is unique, e.g. "${tagName}-2".`,
        });
      }
    }
  }
}
