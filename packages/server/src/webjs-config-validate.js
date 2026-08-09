/**
 * Boot-time validation of the app's `webjs` package.json block (#1300).
 *
 * `webjs-config.schema.json` used to reach users through exactly one wire, the
 * scaffold's `.vscode/settings.json` `$ref`, so a typo'd key was caught only for
 * a VS Code user with `package.json` open. Everywhere else the key was silently
 * dropped and the feature stayed at its default with no diagnostic, which is the
 * exact gap the `WebjsConfig` type's own docblock claims to close.
 *
 * The validator now also runs at boot, from `createRequestHandler`, so `webjs
 * dev`, `webjs start`, and an embedded host all get it from one call site.
 *
 * IT WARNS, NEVER THROWS. A typo costs one feature sitting at its default; a
 * hard boot failure over a schema quibble costs the whole app, on a deploy, at
 * the worst possible moment. That is also Next's posture (unknown and invalid
 * options warn and the boot continues, only required or migrated options are
 * fatal), and WebJs has no required keys at all since every one is optional with
 * a default.
 *
 * This is deliberately SEPARATE from `readDoctorPolicy`'s hand-written
 * `webjs.doctor.gate` validation in the CLI (#1257), which stays. That one runs
 * where `@webjsdev/server` may not resolve (#954), checks gate keys against the
 * real `DOCTOR_CODES` set (membership this schema cannot express), and fails
 * CLOSED because a silently-ignored gate leaves CI un-gated while the
 * package.json looks gated. One function cannot honour both failure modes, so
 * do not "clean up" the apparent duplication.
 *
 * Depth stays at the top level on purpose: key membership, `enum`, and
 * `boolean` / `integer` leaves. Descending into nested objects would have to
 * reckon with the free-form `headers`, `redirects`, and `csp` shapes, which is a
 * behaviour change of its own with real false-positive risk, so `webjs.dev.beforee`
 * stays uncaught for now.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A tiny structural validator standing in for ajv (which the repo does not
 * ship). It only checks the constraints this schema relies on: known-key
 * membership, `additionalProperties: false`, a top-level `type`, and the
 * `enum` on a scalar leaf. Enough to prove a few example configs pass and a
 * typo'd / bad-enum config fails, without adding a dependency.
 *
 * @param {Record<string, unknown>} schema the webjs-block schema
 * @param {Record<string, unknown>} value a candidate `webjs` object
 * @returns {string[]} a list of validation errors (empty = valid)
 */
export function validateWebjsBlock(schema, value) {
  /** @type {string[]} */
  const errors = [];
  const props = schema.properties || {};
  for (const [key, raw] of Object.entries(value)) {
    if (schema.additionalProperties === false && !(key in props)) {
      errors.push(`unknown key "${key}"`);
      continue;
    }
    const def = /** @type {any} */ (props[key]);
    if (!def) continue;
    if (def.enum && !def.enum.includes(raw)) {
      errors.push(`"${key}" must be one of ${JSON.stringify(def.enum)}`);
    }
    if (def.type === 'boolean' && typeof raw !== 'boolean') {
      errors.push(`"${key}" must be a boolean`);
    }
    if (def.type === 'integer' && !Number.isInteger(raw)) {
      errors.push(`"${key}" must be an integer`);
    }
  }
  return errors;
}

/** @type {Record<string, unknown> | null} */
let cachedSchema = null;

/**
 * Load the published `webjs-config.schema.json` that sits at this package's
 * root. Memoized for the process lifetime, since it ships inside the tarball and
 * cannot change under a running server. An unreadable or unparseable schema
 * yields `null`, which makes validation a no-op rather than a boot failure.
 *
 * @returns {Record<string, unknown> | null}
 */
function loadSchema() {
  if (cachedSchema) return cachedSchema;
  try {
    const path = fileURLToPath(new URL('../webjs-config.schema.json', import.meta.url));
    cachedSchema = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return cachedSchema;
}

/**
 * Validate the `webjs` block of a parsed package.json against the published
 * schema.
 *
 * Returns `[]` for an app with no `webjs` block and for one whose `webjs` is not
 * a plain object, since neither is a typo this can usefully report and the
 * readers already treat both as "unconfigured".
 *
 * @param {unknown} pkg a parsed package.json (or anything)
 * @returns {string[]} one message per problem (empty = nothing to say)
 */
export function validateAppWebjsConfig(pkg) {
  const block = /** @type {any} */ (pkg)?.webjs;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
  const schema = loadSchema();
  if (!schema) return [];
  return validateWebjsBlock(schema, block);
}
