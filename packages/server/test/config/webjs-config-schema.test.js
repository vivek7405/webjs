/**
 * Drift guard for the `webjs` config JSON Schema (#259).
 *
 * The schema at packages/server/webjs-config.schema.json describes the
 * `webjs.*` package.json block that the server readers consume. This test
 * keeps the schema honest against the CODE: every key a reader actually
 * accepts must be a property in the schema, and a deliberately-unknown key
 * must NOT be (so `additionalProperties: false` genuinely flags a typo).
 *
 * Counterfactual: if a reader gains a new `webjs.*` key and the schema is
 * not updated, `KNOWN_KEYS` (kept in sync by the author) drives the
 * "every known key is in the schema" assertion to fail; and the
 * `notARealKey` assertion proves the schema rejects an unknown key, which
 * is the whole point of the additionalProperties guard.
 *
 * Dependency-free: webjs ships no JSON-Schema validator (no ajv), so the
 * structural assertions plus a tiny hand-rolled checker for the handful of
 * constraints we care about stand in for full validation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(
  new URL('../../webjs-config.schema.json', import.meta.url),
);

/**
 * The complete set of `webjs.*` config keys a reader accepts. Most are
 * consumed by a SERVER reader; a few are consumed by the CLI instead, and
 * `dev` is SPLIT (its task sub-keys are CLI-read, `dev.regenerate` and
 * `dev.watch` are server-read), so the CLI-vs-server question is per
 * sub-key rather than per top-level key. Either way the key lives in the
 * same `webjs` block and so must be in the schema, or
 * `additionalProperties:false` would flag a valid app's config.
 *
 * The per-key reader annotations below are a convenience, NOT the
 * inventory: packages/server/AGENTS.md holds the one canonical reader list
 * and the lockstep procedure. Every duplicate of that list has drifted, so
 * do not grow another one here. The drift assertions below cross-check
 * this key list against the schema in BOTH directions.
 */
const KNOWN_KEYS = [
  'elide', // readElideEnabled (dev.js)
  'seed', // readSeedEnabled (dev.js)
  'clientRouter', // readClientRouterEnabled (dev.js)
  'headers', // compileHeaderRules (headers.js)
  'redirects', // compileRedirectRules (redirects.js)
  'trailingSlash', // readTrailingSlashPolicy (redirects.js)
  'basePath', // readBasePath (base-path.js)
  'allowedOrigins', // readAllowedOrigins (csrf.js)
  'csp', // readCspConfig (csp.js)
  'maxBodyBytes', // readBodyLimits (body-limit.js)
  'maxMultipartBytes', // readBodyLimits (body-limit.js)
  'requestTimeoutMs', // computeServerTimeouts (body-limit.js)
  'headersTimeoutMs', // computeServerTimeouts (body-limit.js)
  'keepAliveTimeoutMs', // computeServerTimeouts (body-limit.js)
  // SPLIT: dev.before / dev.parallel are readAppTasks (cli/lib/app-tasks.js,
  // #550), dev.regenerate is readRegenerateRules (dev-regenerate.js, #967),
  // dev.watch is readDevWatchPathsFromApp (dev.js, #894).
  'dev',
  'start', // readAppTasks (cli/lib/app-tasks.js), CLI-read (#550)
  'doctor', // readDoctorPolicy (cli/lib/doctor.js), CLI-read (#1257)
];

test('schema file is valid JSON and parses', () => {
  const raw = readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(raw);
  assert.equal(typeof schema, 'object');
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.type, 'object');
  assert.ok(schema.title, 'has a title');
  assert.ok(schema.description, 'has a description');
});

test('schema seals the block so an unknown key is flagged', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  assert.equal(
    schema.additionalProperties,
    false,
    'additionalProperties must be false so a typo is diagnosed',
  );
});

test('every known reader key is a schema property', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const props = schema.properties || {};
  for (const key of KNOWN_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(props, key),
      `schema is missing the "${key}" property (a reader accepts it)`,
    );
    assert.ok(props[key].description, `"${key}" must carry a description`);
  }
});

test('schema declares no key the readers do not consume', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const props = Object.keys(schema.properties || {});
  for (const key of props) {
    assert.ok(
      KNOWN_KEYS.includes(key),
      `schema declares "${key}" but no reader consumes it (stale schema or stale KNOWN_KEYS)`,
    );
  }
  assert.equal(props.length, KNOWN_KEYS.length, 'no extra / missing keys');
});

test('a deliberately-unknown key is NOT in the schema (additionalProperties would flag it)', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const props = schema.properties || {};
  assert.equal(
    Object.prototype.hasOwnProperty.call(props, 'notARealKey'),
    false,
    'an unknown key must not be a property; additionalProperties:false then flags it',
  );
});

test('key shapes match the reader contracts', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const p = schema.properties;

  // elide is a boolean (readElideEnabled checks `=== false`).
  assert.equal(p.elide.type, 'boolean');

  // trailingSlash is the three-value enum readTrailingSlashPolicy accepts.
  assert.deepEqual(p.trailingSlash.enum, ['never', 'always', 'ignore']);

  // The numeric ingress knobs are integers with a 0 floor (0 disables).
  for (const k of [
    'maxBodyBytes',
    'maxMultipartBytes',
    'requestTimeoutMs',
    'headersTimeoutMs',
    'keepAliveTimeoutMs',
  ]) {
    assert.equal(p[k].type, 'integer', `${k} is an integer`);
    assert.equal(p[k].minimum, 0, `${k} floors at 0`);
  }

  // headers items require source + a headers directive array.
  assert.deepEqual(p.headers.items.required, ['source', 'headers']);

  // redirects items require source + destination; statusCode is the
  // redirect-code enum resolveStatus() allows.
  assert.deepEqual(p.redirects.items.required, ['source', 'destination']);
  assert.deepEqual(
    p.redirects.items.properties.statusCode.enum,
    [301, 302, 303, 307, 308],
  );

  // csp is boolean | object (readCspConfig accepts true / object).
  assert.ok(Array.isArray(p.csp.oneOf), 'csp is a oneOf(boolean, object)');
});

// The schema and the exported WebjsConfig type are two artifacts that must
// stay in lockstep (the procedure in packages/server/AGENTS.md). The schema is
// already cross-checked against KNOWN_KEYS above; this closes the third edge so
// adding a key to the schema + readers while forgetting the .d.ts (or vice
// versa) fails a test instead of silently drifting.
test('the WebjsConfig type top-level keys match the reader keys', () => {
  const dtsPath = fileURLToPath(
    new URL('../../../core/src/webjs-config.d.ts', import.meta.url),
  );
  const src = readFileSync(dtsPath, 'utf8');
  const start = src.indexOf('interface WebjsConfig');
  assert.ok(start >= 0, 'webjs-config.d.ts declares interface WebjsConfig');
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n}', open);
  const body = src.slice(open + 1, close);
  // Top-level members are indented one level (two spaces) inside the interface.
  // Nested object literals (none today, the type references named shapes) would
  // sit deeper, so anchoring at the two-space indent captures only the keys.
  const keys = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
  assert.deepEqual(
    keys,
    [...KNOWN_KEYS].sort(),
    'WebjsConfig keys must equal the reader keys (schema and type out of lockstep)',
  );
});

// The nested `webjs.dev.regenerate` key (#967) is read by the SERVER
// (readRegenerateRules), not the CLI reader that drives KNOWN_KEYS, so it is not
// covered by the top-level checks above. Guard its triad (schema + type)
// directly so the three stay in lockstep for the nested key too.
test('webjs.dev.regenerate is declared in both the schema and the WebjsConfig type (#967)', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const regen = schema.properties?.dev?.properties?.regenerate;
  assert.ok(regen, 'schema declares webjs.dev.regenerate');
  assert.equal(regen.type, 'array', 'regenerate is an array of rules');
  const rule = regen.items || {};
  assert.deepEqual(
    (rule.required || []).sort(),
    ['command', 'output'],
    'a regenerate rule requires output + command',
  );
  assert.ok(rule.properties?.inputs, 'a regenerate rule has an inputs property');

  const dtsPath = fileURLToPath(
    new URL('../../../core/src/webjs-config.d.ts', import.meta.url),
  );
  const src = readFileSync(dtsPath, 'utf8');
  assert.match(src, /interface WebjsRegenerateRule/, 'the type declares WebjsRegenerateRule');
  assert.match(src, /regenerate\?:\s*WebjsRegenerateRule\[\]/, 'WebjsDevTasks carries regenerate');
});

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
function validateWebjsBlock(schema, value) {
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

test('representative valid configs pass the structural validator', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const valids = [
    { elide: false },
    { trailingSlash: 'never' },
    { csp: true },
    { csp: { directives: { 'connect-src': "'self'" }, reportOnly: true } },
    {
      headers: [{ source: '/embed/:p*', headers: [{ key: 'X-Frame-Options', value: null }] }],
      redirects: [{ source: '/old', destination: '/new', permanent: false }],
      maxBodyBytes: 262144,
      requestTimeoutMs: 0,
    },
  ];
  for (const v of valids) {
    assert.deepEqual(
      validateWebjsBlock(schema, v),
      [],
      `expected ${JSON.stringify(v)} to validate`,
    );
  }
});

test('typo and bad-enum configs are rejected by the validator', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  // A typo'd key (the exact "silently dropped" failure #259 fixes).
  assert.ok(
    validateWebjsBlock(schema, { redirect: [] }).length > 0,
    'a typo key must be rejected',
  );
  // A bad enum value.
  assert.ok(
    validateWebjsBlock(schema, { trailingSlash: 'sometimes' }).length > 0,
    'a bad trailingSlash enum must be rejected',
  );
  // A wrong-typed elide.
  assert.ok(
    validateWebjsBlock(schema, { elide: 'yes' }).length > 0,
    'a non-boolean elide must be rejected',
  );
});
