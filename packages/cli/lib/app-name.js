/**
 * App-name validation for `webjs create <name>` (issue #1066).
 *
 * The name a user passes to `webjs create` is not just a directory name. It is
 * ALSO interpolated into generated source as a template-literal value (the
 * `metadata.title` in `app/page.ts`, the `name` field of the api template's
 * root route handler, the `{{APP_NAME}}` substitution in every copied template
 * file) and written verbatim into the generated `package.json` `name` field. A
 * name carrying a quote, a backtick, a `${`, or a backslash therefore breaks
 * the emitted file at the JS/TS syntax level, and the failure surfaces as a
 * parse error on the very first `npm run dev` of the fresh app, far from its
 * actual cause.
 *
 * Rather than escape at each interpolation site (an open-ended list that grows
 * every time the scaffold emits a new file), the name is validated ONCE at the
 * boundary, before any file is written. The rule is npm package-name
 * compatibility, which is strictly narrower than every interpolation site needs
 * and matches what `npm init` and `create-next-app` enforce, so a name that
 * passes is safe everywhere the scaffold puts it.
 *
 * This module is pure and imports nothing, so both the CLI entry
 * (`bin/webjs.js`) and the programmatic entry (`scaffoldApp` in `lib/create.js`)
 * can share one rule.
 */

/** npm's hard cap on a package name. */
export const APP_NAME_MAX_LENGTH = 214;

/** One-line description of the allowed shape, reused by both error surfaces. */
export const APP_NAME_SHAPE =
  'lowercase letters, digits, and the separators "-", "." and "_", starting with a letter or a digit, at most 214 characters';

/**
 * npm rejects these outright, whatever else the name looks like.
 * @type {string[]}
 */
const RESERVED_NAMES = ['node_modules', 'favicon.ico'];

/** Every character npm allows in an unscoped package name. */
const ALLOWED_CHAR = /[a-z0-9._-]/;

/**
 * Render a character for an error message. A control character has no visible
 * form, so name it by code point instead of printing it.
 * @param {string} ch
 * @returns {string}
 */
function describeChar(ch) {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) {
    return `the control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return `'${ch}'`;
}

/**
 * Pure validator. Returns the first problem it finds, phrased as a sentence
 * fragment that reads after "app name ... because".
 *
 * @param {unknown} name  the raw name as typed
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkAppName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'an app name cannot be empty' };
  }
  if (name.trim() !== name) {
    return { ok: false, reason: 'an app name cannot start or end with whitespace' };
  }
  if (name.length > APP_NAME_MAX_LENGTH) {
    return {
      ok: false,
      reason: `an app name cannot be longer than ${APP_NAME_MAX_LENGTH} characters (this one is ${name.length})`,
    };
  }
  if (RESERVED_NAMES.includes(name)) {
    return { ok: false, reason: `'${name}' is reserved by npm and cannot be a package name` };
  }
  // Report the first offending character, since that is what the user has to
  // change. Uppercase gets its own wording because "not allowed" reads as a
  // typo when the character itself is perfectly ordinary.
  for (const ch of name) {
    if (ALLOWED_CHAR.test(ch)) continue;
    if (/[A-Z]/.test(ch)) {
      return {
        ok: false,
        reason: `'${ch}' is uppercase, and an npm package name must be all lowercase`,
      };
    }
    return { ok: false, reason: `${describeChar(ch)} is not allowed in an app name` };
  }
  // Checked after the character scan so a leading quote is reported as the bad
  // character rather than as a leading-separator problem.
  if (name.startsWith('.') || name.startsWith('_')) {
    return { ok: false, reason: `an app name cannot start with '${name[0]}'` };
  }
  return { ok: true };
}

/**
 * The multi-line message the CLI prints. Kept here so the programmatic throw
 * and the CLI output agree on the rule they state.
 * @param {unknown} name
 * @param {string} reason
 * @returns {string}
 */
export function appNameErrorMessage(name, reason) {
  const shown = typeof name === 'string' ? name : String(name);
  return `Error: invalid app name '${shown}'.

${reason[0].toUpperCase()}${reason.slice(1)}.

The name becomes the app's directory, its npm package name, and a value the
scaffold writes into generated source, so it is restricted to what npm accepts:
${APP_NAME_SHAPE}.

Example: webjs create my-app`;
}

/**
 * Convenience wrapper for callers that want an exception. Throws with a
 * single-line message (a thrown Error is read programmatically, so it stays
 * compact) and returns the validated name otherwise.
 * @param {unknown} name
 * @returns {string}
 */
export function assertValidAppName(name) {
  const result = checkAppName(name);
  if (!result.ok) {
    const shown = typeof name === 'string' ? name : String(name);
    throw new Error(
      `Invalid app name '${shown}'. ${result.reason[0].toUpperCase()}${result.reason.slice(1)}. Allowed: ${APP_NAME_SHAPE}.`,
    );
  }
  return /** @type {string} */ (name);
}
