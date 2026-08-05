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
 * boundary, before any file is written. The rule is npm's package-name rules
 * MINUS the lowercase-only clause (see `ALLOWED_CHAR`), which is still strictly
 * narrower than every interpolation site needs, so a name that passes is safe
 * everywhere the scaffold puts it. `npm init` and `create-next-app` do refuse
 * uppercase; this deliberately does not, because the scaffold's manifest is
 * private and a capital letter breaks nothing.
 *
 * This module is pure and imports nothing, so both the CLI entry
 * (`bin/webjs.js`) and the programmatic entry (`scaffoldApp` in `lib/create.js`)
 * can share one rule.
 */

/** npm's hard cap on a package name. */
export const APP_NAME_MAX_LENGTH = 214;

/** One-line description of the allowed shape, reused by both error surfaces. */
export const APP_NAME_SHAPE =
  'letters, digits, and the separators "-", "." and "_", starting with a letter or a digit, at most 214 characters, and not a name npm reserves';

/**
 * npm rejects these outright, whatever else the name looks like. Matched
 * case-insensitively, since the name is also a directory and `Node_Modules`
 * collides with `node_modules` on a case-insensitive filesystem.
 * @type {string[]}
 */
const RESERVED_NAMES = ['node_modules', 'favicon.ico'];

/**
 * Every character allowed in an app name.
 *
 * npm's own rule for a PUBLISHED package name is lowercase-only, and this guard
 * followed it at first. Uppercase is allowed back deliberately: it never broke
 * anything. The scaffold's `package.json` is `private: true`, so the name is
 * never published, and npm installs a capitalized private package without
 * complaint (checked, not assumed). Every OTHER character this rule refuses
 * corrupts generated source or the manifest, which is what the guard is for, so
 * refusing a capital letter alongside them would have been a naming convention
 * wearing a correctness costume, and `webjs create MyApp` worked before.
 */
const ALLOWED_CHAR = /[A-Za-z0-9._-]/;

/** What a name may start with, per the shape both error surfaces state. */
const ALLOWED_FIRST_CHAR = /[A-Za-z0-9]/;

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
    out += isUnprintable(code)
      ? `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`
      : ch;
  }
  return out.length > DISPLAY_MAX_LENGTH ? `${out.slice(0, DISPLAY_MAX_LENGTH)}...` : out;
}

/**
 * Whether a code point has no safe visible form in an error message. C0 and
 * DEL are the obvious set. Two additions matter here: the C1 range, which is
 * where an 8-bit terminal reads control functions, and U+2028 / U+2029, which
 * are JS LineTerminators, so they break the single-line contract exactly the
 * way `\n` does while sailing past any `split('\n')` that claims to check it.
 * @param {number} code
 * @returns {boolean}
 */
function isUnprintable(code) {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
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
  if (isUnprintable(code)) {
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
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    return { ok: false, reason: `'${name}' is reserved by npm and cannot be a package name` };
  }
  // Report the first offending character, since that is what the user has to
  // change.
  for (const ch of name) {
    if (ALLOWED_CHAR.test(ch)) continue;
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

The name becomes the app's directory, its package.json name, AND a value the
scaffold writes into generated source, so it is restricted to:

  letters and digits
  the separators "-", "." and "_"
  starting with a letter or a digit
  at most ${APP_NAME_MAX_LENGTH} characters
  not ${RESERVED_NAMES.map((n) => `"${n}"`).join(' or ')} (npm reserves both)

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
