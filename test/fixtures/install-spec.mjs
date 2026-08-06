/**
 * Parse a jspm install string into its package name, version, and subpath.
 *
 * Shared by the two vendor fixtures, which need the same parse for different
 * reasons. `test/e2e/fixtures/stub-jspm.mjs` (#1228) uses it to decide whether
 * it can serve an install from this repo, and `test/fixtures/jspm-double.mjs`
 * (#1150) uses it to mint a jspm-shaped URL. Both would otherwise reach for the
 * `install.replace(/@[^@]*$/, '')` shortcut that several inline mocks in
 * `packages/server/test/vendor/vendor.test.js` use, which is wrong on any
 * install carrying a subpath: on `dayjs@1.11.13/plugin/utc` the trailing
 * `@1.11.13/plugin/utc` is one match, so the whole subpath disappears with the
 * version and the caller believes the install was a bare `dayjs`.
 *
 * This module has NO side effects, so importing it never patches anything.
 */

/**
 * Split an install string into its package name, version, and subpath.
 *
 * The four shapes, all of which jspm accepts: `dayjs`, `dayjs@1.11.21`,
 * `dayjs/plugin/utc`, `dayjs@1.11.21/plugin/utc`, each also in scoped form
 * (`@scope/pkg...`). So the version is OPTIONAL and the subpath does not always
 * ride behind one, which rules out cutting at the version separator alone: on
 * `dayjs/plugin/utc` there is no `@` to cut at, and taking the whole string as
 * the name would report no subpath for an install that plainly has one.
 *
 * Cut on the first `/` that is not part of a scope instead, then strip any
 * version off the name. A scoped name's leading `@` is not a version separator
 * and its first `/` is not a subpath, hence the offsets.
 *
 * @param {string} install
 * @returns {{ name: string, version: string, subpath: string }}
 */
export function splitInstall(install) {
  const scoped = install.startsWith('@');
  // For a scoped install the subpath starts at the SECOND slash, since the
  // first one separates the scope from the package.
  const scopeSlash = scoped ? install.indexOf('/') : -1;
  const slash = install.indexOf('/', scoped ? scopeSlash + 1 : 0);
  const head = slash === -1 ? install : install.slice(0, slash);
  const at = head.indexOf('@', scoped ? 1 : 0);
  return {
    name: at === -1 ? head : head.slice(0, at),
    version: at === -1 ? '' : head.slice(at + 1),
    subpath: slash === -1 ? '' : install.slice(slash),
  };
}

/** @param {string} install @returns {string} */
export function packageName(install) { return splitInstall(install).name; }

/**
 * The version an install pins, or the empty string when it names none.
 * @param {string} install
 * @returns {string}
 */
export function packageVersion(install) { return splitInstall(install).version; }

/**
 * The part of an install after its package name AND version, if any, so
 * `/plugin/utc` for both `dayjs/plugin/utc` and `dayjs@1.11.21/plugin/utc`. A
 * subpath needs its own importmap key pointing at its own file.
 * @param {string} install
 * @returns {string}
 */
export function subpath(install) { return splitInstall(install).subpath; }

/**
 * The importmap KEY an install resolves under, which is the package name plus
 * the subpath and never the version. `dayjs@1.11.21/plugin/utc` is imported in
 * source as `dayjs/plugin/utc`, so that is what the browser looks up.
 * @param {string} install
 * @returns {string}
 */
export function importKey(install) {
  const { name, subpath: sub } = splitInstall(install);
  return `${name}${sub}`;
}
