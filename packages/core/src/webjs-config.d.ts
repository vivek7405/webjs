/**
 * TypeScript overlay for the `webjs` config block in a WebJs app's
 * package.json.
 *
 *     // package.json is JSON, so author it there, but a typed reference
 *     // helps an agent or a human author the block correctly:
 *     import type { WebjsConfig } from '@webjsdev/core';
 *     const config: WebjsConfig = { trailingSlash: 'never', csp: true };
 *
 * This object is read key by key, mostly by the server and for a few keys
 * by the CLI. Without a type or schema a typo'd key (e.g. `redirect` for
 * `redirects`) was silently dropped and the feature stayed at its default
 * with no diagnostic. Three things close that gap now, at three different
 * moments: this type while an agent or a human authors the block, the
 * published JSON Schema in an editor via the scaffold's `.vscode` `$ref`,
 * and `webjs-config-validate.js` at BOOT (#1300), which runs that same
 * schema from `createRequestHandler` and warns once, naming every unknown
 * top-level key, every bad `enum` value, and every wrong-typed `boolean` /
 * `integer` (9 of the 17 keys). It does NOT type-check the other 8
 * (`headers`, `redirects`, `basePath`, `allowedOrigins`, `csp`, `dev`,
 * `start`, `doctor`), so giving one of THOSE the wrong type outright
 * (`"headers": "x"`) passes the boot check and its reader then falls back
 * to the default without a word. Only that key-level case is unreported: a
 * malformed ENTRY inside a well-shaped `headers` / `redirects` array
 * already warns from the reader, and a bad `doctor` shape exits
 * `webjs doctor` non-zero rather than being dropped. The boot check warns
 * and never throws, so a typo costs one feature its setting rather than
 * the whole app its boot.
 *
 * LOCKSTEP: this file, the JSON Schema at
 * packages/server/webjs-config.schema.json, and the reader functions MUST
 * stay in sync, so adding a `webjs.*` key means updating all three places
 * (plus the KNOWN_KEYS drift test). The reader inventory is NOT repeated
 * here on purpose: packages/server/AGENTS.md holds the one canonical list
 * along with the procedure, and every copy of it that existed drifted.
 *
 * Every key is optional (the whole block is optional and every key has a
 * default). Zero runtime cost: nothing in this file ships to the browser.
 */

/** One header directive in a `webjs.headers` rule. */
export interface WebjsHeaderDirective {
  /** Header name, e.g. `X-Frame-Options`. */
  key: string;
  /**
   * Header value. A `null` or `false` value REMOVES the header on a
   * match, the escape hatch that drops a secure default on a path.
   * `true` is intentionally not allowed (the runtime would stringify it
   * to the literal `"true"`, which is never a useful header value).
   */
  value?: string | null | false;
}

/** One per-path response-header rule in `webjs.headers`. */
export interface WebjsHeaderRule {
  /**
   * Path pattern matched with the native URLPattern API, so `:param` and
   * `:rest*` syntax works.
   */
  source: string;
  /** Header directives applied on a match. */
  headers: WebjsHeaderDirective[];
}

/** One declarative redirect rule in `webjs.redirects`. */
export interface WebjsRedirectRule {
  /**
   * Path pattern matched with the native URLPattern API, so `:param` and
   * `:rest*` syntax works.
   */
  source: string;
  /**
   * Target path, a path referencing named groups captured by `source`,
   * or an absolute URL. The incoming query string is preserved and
   * merged onto the destination.
   */
  destination: string;
  /**
   * `true` (the default) is a 308 Permanent Redirect, `false` is a 307
   * Temporary Redirect. Both preserve the request method and body.
   * `statusCode` wins over this when set.
   */
  permanent?: boolean;
  /**
   * Explicit redirect status, for a tool needing a legacy code. Wins
   * over `permanent`. One of 301, 302, 303, 307, 308.
   */
  statusCode?: 301 | 302 | 303 | 307 | 308;
}

/** The trailing-slash canonicalization policy in `webjs.trailingSlash`. */
export type WebjsTrailingSlash = 'never' | 'always' | 'ignore';

/** A single on-request regeneration rule in `webjs.dev.regenerate` (#967). */
export interface WebjsRegenerateRule {
  /** The appDir-relative served output this rule rebuilds (e.g. `"public/tailwind.css"`); a leading slash is stripped. */
  output: string;
  /** The shell command that rebuilds `output` (the same command prod uses in `start.before`, so dev and prod cannot diverge). */
  command: string;
  /** Source files/directories whose newest mtime is compared to `output`'s; a newer one (or a missing output) triggers the rebuild. */
  inputs?: string[];
}

/** Dev task orchestration in `webjs.dev` (#550). `before`/`parallel` read by the CLI, `regenerate` and `watch` by the server (each sub-key names its own reader below). */
export interface WebjsDevTasks {
  /**
   * One-shot commands run sequentially to completion BEFORE the dev server
   * boots (the old `predev` hook: `webjs db migrate`, a registry copy). A
   * non-zero exit aborts the boot. Read by the CLI (`readAppTasks`).
   */
  before?: string[];
  /**
   * Long-lived commands run as child processes ALONGSIDE the dev server (the
   * old `concurrently` watchers). Spawned once in the parent and torn down on
   * exit, so a watcher cannot leak past the server. Read by the CLI
   * (`readAppTasks`).
   */
  parallel?: string[];
  /**
   * On-request build-output regeneration (#967), DEV-ONLY. Each rule rebuilds a
   * stale `output` before the dev server serves it, so a static build product
   * (the scaffold's `public/tailwind.css`, #947) never goes stale without a
   * live `--watch` process that can die mid-session. Prod builds the same output
   * once via `start.before`. Read by the server (`readRegenerateRules`).
   */
  regenerate?: WebjsRegenerateRule[];
  /**
   * Extra directories the dev live-reload watcher follows IN ADDITION to the
   * appDir (#894). The dev server watches its appDir recursively, but an app
   * that reads content from OUTSIDE its tree (e.g. blog markdown in a repo-root
   * `blog/` dir, a sibling of the app) sees no reload when that content changes.
   * Each entry is resolved relative to the app root and MAY escape it
   * (`"../blog"`); a change under one triggers the same rebuild + browser reload
   * as an in-tree edit. Missing / overlapping (ancestor or descendant of the
   * appDir) entries are skipped. Read by the server (`readDevWatchPathsFromApp`).
   */
  watch?: string[];
}

/** Start task orchestration in `webjs.start` (#550). Read by the CLI, not the server. */
export interface WebjsStartTasks {
  /**
   * One-shot commands run sequentially to completion BEFORE the prod server
   * boots (the old `prestart` hook: `webjs db migrate`). A non-zero exit
   * aborts the boot.
   */
  before?: string[];
}

/**
 * A severity a `webjs.doctor.gate` entry may declare, mirroring ESLint's
 * three-level scale. `error` fails the `webjs doctor` exit, `warn` reports
 * without failing, and `off` silences the check: its finding is not printed and
 * it cannot fail the exit, including under `--strict`. A silenced check still
 * appears on the checklist as `[off]` and in the summary's silenced count, and
 * `--json` still carries its whole result.
 */
export type WebjsDoctorSeverity = 'off' | 'warn' | 'error';

/** The object form of `webjs.doctor` (#1257). */
export interface WebjsDoctorConfig {
  /**
   * Per-check severity, keyed by the stable doctor code (`NODE_VERSION`,
   * `UNMARKED_ASSET_LINKS`, `ELISION_CARRIERS`, and so on; `webjs doctor --json`
   * carries the code on every result). A code with no entry keeps its default:
   * `error` for a hard toolchain failure, `warn` otherwise. This is how CI gates
   * on a chosen subset without `--strict` making every warning fatal.
   *
   * A malformed gate is a hard error, so a typo cannot silently un-gate CI:
   * that covers an unknown code, a bad severity, a wrong SHAPE (a non-object
   * `doctor` or `gate`), and a misspelled sibling of `gate` such as `gates`.
   * A result that could not check (a network or toolchain outage) is capped at
   * `warn` and can never be escalated to `error`.
   */
  gate?: Record<string, WebjsDoctorSeverity>;
}

/** The object form of `webjs.csp` (the non-boolean shape). */
export interface WebjsCspConfig {
  /**
   * Directive map merged over the strict defaults, e.g.
   * `{ 'connect-src': "'self' https://api.example.com" }`. A `null` /
   * `false` / `''` value drops a default directive. A `__NONCE__` token
   * in a value is replaced with the per-request nonce.
   */
  directives?: Record<string, string | null | boolean>;
  /**
   * `true` emits `Content-Security-Policy-Report-Only` instead of the
   * enforcing header (the staged-rollout path).
   */
  reportOnly?: boolean;
}

/**
 * The `webjs` object in a WebJs app's package.json. Every key is
 * optional. Mirrors what the server readers actually consume, NOT a
 * Next.js superset.
 */
export interface WebjsConfig {
  /**
   * Display-only and inert-route dead-JS elision switch. Default `true`.
   * Set to `false` to ship every module's JS app-wide. The `WEBJS_ELIDE`
   * env override wins over this.
   */
  elide?: boolean;

  /**
   * SSR action-result seeding switch (#472). Default `true`. When on, a
   * `'use server'` action's SSR result is serialized into the page so an
   * `async render()` component does not re-fetch it over RPC on hydration. Set
   * to `false` to disable (the client re-fetches as before). The `WEBJS_SEED`
   * env override wins over this.
   */
  seed?: boolean;

  /**
   * Client-router switch (#629). Default `true`: the client router auto-enables
   * in the browser whenever `@webjsdev/core` loads, so any page that ships a
   * component gets SPA-style navigation with no import. Set to `false` to opt
   * the whole app out (pure MPA, full-page navigation; `disableClientRouter()`
   * stays the programmatic escape hatch).
   */
  clientRouter?: boolean;

  /**
   * Dev/start task orchestration (#550). `webjs dev` / `webjs start` run these
   * so a bare CLI invocation matches `npm run dev` / `start`. Read by the CLI
   * (`packages/cli/lib/app-tasks.js`), NOT the server readers.
   */
  dev?: WebjsDevTasks;
  start?: WebjsStartTasks;

  /**
   * `webjs doctor` policy (#1257): which project-health checks the project
   * treats as fatal. Read by the CLI (`packages/cli/lib/doctor.js`), NOT the
   * server readers.
   */
  doctor?: WebjsDoctorConfig;

  /** Per-path response-header rules, shaped like Next's. */
  headers?: WebjsHeaderRule[];

  /** Declarative permanent / temporary redirects for moved URLs. */
  redirects?: WebjsRedirectRule[];

  /**
   * Trailing-slash canonicalization policy. Default `'ignore'` (no-op).
   * `'never'` strips a trailing slash, `'always'` adds one (both via a
   * 308 redirect).
   */
  trailingSlash?: WebjsTrailingSlash;

  /**
   * Sub-path deployment prefix for an app mounted under
   * `example.com/app/` behind a proxy that does NOT strip the prefix.
   * `'app'`, `'/app'`, and `'/app/'` all normalize to `'/app'`; an empty
   * value (the default) is a root mount and a pure no-op. The prefix is
   * stripped from the incoming path at ingress and prepended to every
   * framework-emitted URL (importmap targets, modulepreload hints, boot
   * module specifiers, the dev reload src). Author-written `<a href>`
   * links and client-router navigation are NOT auto-prefixed (a
   * documented follow-up).
   */
  basePath?: string;

  /**
   * Cross-origin hosts (or full origins) the action CSRF check accepts even
   * when the request is cross-site. The action endpoint defends against CSRF
   * with a `Sec-Fetch-Site` check plus an `Origin`-vs-host fallback; list any
   * additional origins a reverse-proxy / multi-domain setup must allow here,
   * e.g. `['admin.example.com', 'https://studio.example.com']`. A bare host or
   * a full origin are both accepted. Default `[]` (same-origin only).
   */
  allowedOrigins?: string[];

  /**
   * Content-Security-Policy config. Off by default. `true` enables a
   * strict nonce-based default policy. An object customizes directives
   * and report-only mode.
   */
  csp?: boolean | WebjsCspConfig;

  /**
   * JSON / RPC request body cap in bytes. Default 1048576 (1 MiB). `0`
   * disables the cap. The `WEBJS_MAX_BODY_BYTES` env override wins.
   */
  maxBodyBytes?: number;

  /**
   * Form / multipart request body cap in bytes. Default 10485760 (10
   * MiB). `0` disables the cap. The `WEBJS_MAX_MULTIPART_BYTES` env
   * override wins.
   */
  maxMultipartBytes?: number;

  /**
   * Max time in ms to receive the ENTIRE request (headers plus body).
   * Default 30000. `0` disables the timeout. The
   * `WEBJS_REQUEST_TIMEOUT_MS` env override wins.
   */
  requestTimeoutMs?: number;

  /**
   * Max time in ms to receive just the request headers. Default 20000.
   * Clamped strictly under `requestTimeoutMs` per node semantics. `0`
   * disables the timeout. The `WEBJS_HEADERS_TIMEOUT_MS` env override
   * wins.
   */
  headersTimeoutMs?: number;

  /**
   * Idle time in ms before a kept-alive socket is closed. Default 5000.
   * `0` disables the timeout. The `WEBJS_KEEP_ALIVE_TIMEOUT_MS` env
   * override wins.
   */
  keepAliveTimeoutMs?: number;
}
