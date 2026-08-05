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

/** What a name may start with, per the shape both error surfaces state. */
const ALLOWED_FIRST_CHAR = /[a-z0-9]/;

/**
 * How much of the rejected name to echo back. The name is attacker-shaped by
 * definition here (it is the thing that just failed validation), and it is
 * echoed into a terminal, so it is capped rather than printed whole.
 */
const DISPLAY_MAX_LENGTH = 48;

/**
 * Render the rejected name for an error message. Two things it must not do:
 * break the message onto a second line (a thrown Error is read programmatically
 * and documented as single-line, and a newline is a name `checkAppName`
 * rejects), and replay a control sequence into the terminal it is printed to (a
 * name of `\x1b[31m...` would otherwise repaint the user's shell). So every
 * character with no safe visible form is named by code point, and the result is
 * capped so a 214-character name cannot produce a 240-column line.
 * @param {unknown} name
 * @returns {string}
 */
function describeName(name) {
  const raw = typeof name === 'string' ? name : String(name);
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f
      ? `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`
      : ch;
  }
  return out.length > DISPLAY_MAX_LENGTH ? `${out.slice(0, DISPLAY_MAX_LENGTH)}...` : out;
}

/**
 * Render a character for an error message. A control character has no visible
 * form, so name it by code point instead of printing it. The quote delimiter is
 * picked to avoid the character itself, so a rejected apostrophe does not print
 * as the unreadable `'''`.
 * @param {string} ch
 * @returns {string}
 */
function describeChar(ch) {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) {
    return `the control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  if (ch === ' ') return 'a space';
  const q = ch === "'" ? '"' : "'";
  return `${q}${ch}${q}`;
}

/**
 * Pure validator. Returns the first problem it finds, phrased as a sentence
 * fragment that reads after "app name ... because".
 *
 * @param {unknown} name  the raw name as typed
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkAppName(name) {
  // A non-string reaches here only from a programmatic caller, and calling it
  // "empty" states something false about the input (a `123` is not empty), which
  // is worse than no message at all when the reader is debugging their own call.
  if (typeof name !== 'string') {
    return { ok: false, reason: `an app name must be a string (this one is a ${typeof name})` };
  }
  if (name.length === 0) {
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
  // character rather than as a leading-separator problem. Every separator is
  // refused here, not just the leading dot and underscore npm itself refuses:
  // the shape both error surfaces state is "starting with a letter or a digit",
  // and a rule the message claims but does not enforce is worse than either
  // rule on its own. A leading hyphen also reads as a flag everywhere the name
  // is later used as a directory.
  if (!ALLOWED_FIRST_CHAR.test(name[0])) {
    return { ok: false, reason: `an app name cannot start with ${describeChar(name[0])}` };
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
  return `Error: invalid app name "${describeName(name)}".

${reason[0].toUpperCase()}${reason.slice(1)}.

The name becomes the app's directory, its npm package name, AND a value the
scaffold writes into generated source, so it has to be a name npm accepts:

  lowercase letters and digits
  the separators "-", "." and "_"
  starting with a letter or a digit
  at most ${APP_NAME_MAX_LENGTH} characters

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
    throw new Error(
      `Invalid app name '${describeName(name)}'. ${result.reason[0].toUpperCase()}${result.reason.slice(1)}. Allowed: ${APP_NAME_SHAPE}.`,
    );
  }
  return /** @type {string} */ (name);
}
