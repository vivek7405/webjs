/**
 * `webjs mcp`: a minimal, READ-ONLY Model Context Protocol server (#262).
 *
 * Exposes the live introspection surface an AI agent needs while editing a
 * WebJs app (the route table, registered server actions with their RPC
 * endpoints, registered custom-element tags, and the structured `webjs check`
 * violations) over MCP's stdio transport. Every tool REUSES an existing
 * `@webjsdev/server` data function and MUTATES NOTHING. The prior art is
 * Next.js's `next-devtools-mcp` (get_routes / get_server_action_by_id /
 * get_errors); this is deliberately tiny.
 *
 * Transport: MCP stdio is newline-delimited JSON-RPC 2.0. One JSON object per
 * line arrives on stdin; exactly one JSON response line per request is written
 * to stdout. STDOUT IS THE PROTOCOL CHANNEL, so this module writes ONLY
 * JSON-RPC frames there and routes every diagnostic to stderr. A malformed
 * input line is answered with a JSON-RPC parse error and never crashes the
 * loop. Hand-rolled with zero new dependency (WebJs is buildless +
 * minimal-deps).
 *
 * @module mcp
 */

import { createInterface } from 'node:readline';
import { relative } from 'node:path';

import {
  resolveDocsLocation,
  listResources,
  readResource,
  initText,
  searchDocs,
  PROMPTS,
  getPrompt,
} from './mcp-docs.js';
import { resolveFrameworkRoots, runSourceTool } from './mcp-source.js';
import { projectRoutes } from './routes-report.js';

const PROTOCOL_VERSION = '2024-11-05';

// Mirrors packages/server/src/action-config.js. A drift test in
// packages/mcp/test/mcp.test.mjs asserts these stay in sync with the source.
/** HTTP verbs an action may declare (mirrors RPC_VERBS in action-config.js). */
const RPC_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Reserved config export names in a 'use server' file (mirrors RESERVED_CONFIG in action-config.js). */
const RESERVED_CONFIG = new Set(['method', 'cache', 'tags', 'invalidates', 'validate', 'middleware']);

/**
 * The four read-only tools. Each takes an optional `{ appDir }` (default the
 * server's cwd) and projects an EXISTING `@webjsdev/server` function's output
 * into an agent-friendly shape. Descriptions are crisp so a model picks the
 * right tool without reading source.
 */
/** The shared input schema for the introspection tools: an optional appDir override. */
const APPDIR_SCHEMA = {
  type: 'object',
  properties: {
    appDir: {
      type: 'string',
      description: 'App directory to introspect. Defaults to the server cwd.',
    },
  },
  required: [],
};

/** `init` takes no input. */
const INIT_SCHEMA = { type: 'object', properties: {}, required: [] };

/** `docs` takes an optional topic OR a free-text query. */
const DOCS_SCHEMA = {
  type: 'object',
  properties: {
    topic: {
      type: 'string',
      description: 'A doc name (e.g. components, recipes, lit-muscle-memory-gotchas, AGENTS). Returns the full doc.',
    },
    query: {
      type: 'string',
      description: 'Free-text search across all webjs docs. Returns matching lines with their source.',
    },
  },
  required: [],
};

/** `ui` lists the @webjsdev/ui kit, or details one component by `name`. */
const UI_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'A component name (e.g. button, accordion, dialog). Omit for the full kit inventory.',
    },
  },
  required: [],
};

/** `source` reads the framework source: a `path` to read, a `query` to grep, or a `package` to list. */
const SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'A framework source file to read, e.g. server/src/ssr.js or @webjsdev/core/src/render-client.js.',
    },
    query: {
      type: 'string',
      description: 'Grep the @webjsdev/* src trees for this substring. Returns file:line hits.',
    },
    package: {
      type: 'string',
      description: 'Limit a no-args listing to one package (core, server, cli, intellisense, ui).',
    },
  },
  required: [],
};

/**
 * The tools. The four introspection tools project an EXISTING @webjsdev/server
 * function (read-only, appDir-scoped). `init` + `docs` (#376) surface the
 * framework knowledge: `init` is the "read first" mental-model primer, `docs`
 * retrieves a doc by topic or searches the corpus. Descriptions are crisp so a
 * model picks the right tool without reading source.
 */
const TOOL_DEFS = [
  {
    name: 'init',
    description:
      'READ THIS FIRST before writing or editing a webjs app. Returns the webjs mental model (NOT React/Next: no RSC, components hydrate but pages do not, signals-default state, the .server boundary) plus the invariants and the doc index. Read-only.',
    inputSchema: INIT_SCHEMA,
  },
  {
    name: 'docs',
    description:
      'Retrieve webjs framework docs: pass `topic` for a full doc (components, recipes, styling, built-ins, configuration, advanced, metadata, typescript, testing, lit-muscle-memory-gotchas, AGENTS, ...) or `query` to search the corpus. No args returns the topic index. Read-only.',
    inputSchema: DOCS_SCHEMA,
  },
  {
    name: 'source',
    description:
      'Read the FRAMEWORK authored source (webjs is buildless: node_modules/@webjsdev/*/src is the JSDoc source, run directly server-side; only the core browser bundle is built into dist/, which this skips). Pass `path` to read a file (e.g. server/src/ssr.js), `query` to grep the @webjsdev/* src trees, or no args to list the packages + entry points. Use when the docs do not answer something. Read-only.',
    inputSchema: SOURCE_SCHEMA,
  },
  {
    name: 'ui',
    description:
      'The @webjsdev/ui component kit (shadcn-style, copied into your repo). No args returns the inventory (each component: tier, helper signatures, npm deps); pass `name` for one component: helper signatures, the paste-ready structural example, the a11y/description header, and deps. Use before hand-writing UI so you reach for a helper (e.g. buttonClass()) and the accessible structure instead of expanding Tailwind blind. Reads the kit, not your app. Read-only.',
    inputSchema: UI_SCHEMA,
  },
  {
    name: 'list_routes',
    description:
      'List the app route table: SSR pages (path, file, dynamic flag, param names) and route.{js,ts} API handlers (path, file, HTTP methods). Read-only.',
    inputSchema: APPDIR_SCHEMA,
  },
  {
    name: 'list_actions',
    description:
      'List registered server actions (the .server.{js,ts} files with "use server"): file, exported function name, the /__webjs/action/<hash>/<fn> RPC endpoint, HTTP verb (method), cache config, and boolean flags for tags/invalidates/validate/middleware. Config-only exports (method, cache, tags, invalidates, validate, middleware) are NOT listed as actions. Read-only.',
    inputSchema: APPDIR_SCHEMA,
  },
  {
    name: 'list_components',
    description:
      'List registered custom-element tags: tag name, defining file, and class name. Read-only.',
    inputSchema: APPDIR_SCHEMA,
  },
  {
    name: 'list_elision',
    description:
      'Report the display-only elision verdict: every component module with whether it is elided (the browser never downloads it) or shipped plus the evidence that produced the verdict, every page/layout route module as inert / import-only / shipped (with the first client-effecting blocker that pins it), and any ORPHAN component class, one that either has no registration call at all or registers a computed tag, which the scanner cannot see either way, so it never upgrades and gets no verdict at all. Identical to `webjs elision --json`. Read-only.',
    inputSchema: APPDIR_SCHEMA,
  },
  {
    name: 'check',
    description:
      'Run webjs check (correctness rules) and return the structured violations { rule, file, message, fix } plus a summary count and per-rule breakdown. Read-only.',
    inputSchema: APPDIR_SCHEMA,
  },
];

/**
 * Lexically extract the names exported from a module source. Recognises the
 * common forms a server-action / route file uses without LOADING the module
 * (loading would run its top-level side effects: DB init, connections).
 *
 *   export async function foo() {}   export function foo() {}
 *   export const foo = ...           export let/var foo = ...
 *   export default ...               (recorded as 'default')
 *   export { a, b as c }             (the EXPORTED name, so `c`)
 *
 * @param {string} src
 * @returns {string[]} unique export names, in source order
 */
export function extractExportNames(src) {
  /** @type {string[]} */
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };

  // export [async] function NAME / export const|let|var NAME / export class NAME
  const declRe =
    /\bexport\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = declRe.exec(src)) !== null) add(m[1]);

  // export default ...
  if (/\bexport\s+default\b/.test(src)) add('default');

  // export { a, b as c, default as d }
  const namedRe = /\bexport\s*\{([^}]*)\}/g;
  while ((m = namedRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      // `local as exported` -> the exported name is what callers import.
      const asMatch = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(seg);
      if (asMatch) add(asMatch[1]);
      else {
        const idMatch = /^([A-Za-z_$][\w$]*)$/.exec(seg);
        if (idMatch) add(idMatch[1]);
      }
    }
  }
  return names;
}

/**
 * Lexically extract the HTTP method exports of a route.{js,ts} file. The webjs
 * API router (`api.js`) dispatches the five standard verbs, plus `WS` for a
 * WebSocket upgrade. We report exactly those that are exported, NOT `HEAD` /
 * `OPTIONS` (the router does not dispatch a named handler for them, so listing
 * them would imply a route the framework ignores). Read-only: no module load.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function extractRouteMethods(src) {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS'];
  const exported = new Set(extractExportNames(src));
  return METHODS.filter((m) => exported.has(m));
}

/**
 * Lexically extract the HTTP-verb action config declared as reserved sibling
 * exports in a `'use server'` file (#488). Reads source text only (no module
 * load) so there are no DB-init side effects.
 *
 * Returned shape:
 *   {
 *     method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',  // default 'POST'
 *     cache: string | null,    // raw RHS literal when present, else null
 *     tags: boolean,           // whether the tags export is declared
 *     invalidates: boolean,    // whether the invalidates export is declared
 *     validate: boolean,       // whether the validate export is declared
 *     middleware: boolean,     // whether the middleware export is declared
 *   }
 *
 * @param {string} src
 * @returns {{ method: string, cache: string|null, tags: boolean, invalidates: boolean, validate: boolean, middleware: boolean }}
 */
export function extractActionConfig(src) {
  // Extract `method` from: export const method = 'GET'  (single/double/backtick)
  const methodMatch = /\bexport\s+const\s+method\s*=\s*(['"`])([A-Za-z]+)\1/.exec(src);
  let method = 'POST';
  if (methodMatch) {
    const upper = methodMatch[2].toUpperCase();
    if (RPC_VERBS.has(upper)) method = upper;
  }

  // Extract `cache` RHS. Single-line: `export const cache = 60` -> '60'
  // Multi-line object: capture balanced braces across lines.
  let cache = null;
  const cacheMatch = /\bexport\s+const\s+cache\s*=\s*/.exec(src);
  if (cacheMatch) {
    const rest = src.slice(cacheMatch.index + cacheMatch[0].length);
    if (rest.startsWith('{')) {
      // Capture the balanced-brace object (may span lines).
      let depth = 0;
      let end = 0;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '{') depth++;
        else if (rest[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      cache = rest.slice(0, end + 1).trim();
    } else {
      // Single-line: read up to the first newline or semicolon.
      const lineMatch = /^([^\n;]+)/.exec(rest);
      if (lineMatch) cache = lineMatch[1].trim();
    }
  }

  // Boolean presence of the remaining config names.
  const exported = new Set(extractExportNames(src));
  return {
    method,
    cache,
    tags: exported.has('tags'),
    invalidates: exported.has('invalidates'),
    validate: exported.has('validate'),
    middleware: exported.has('middleware'),
  };
}

/**
 * The tool runners. Each is async, takes `(appDir)`, and returns a plain
 * JSON-serialisable projection of an existing server data function. All are
 * read-only.
 *
 * @param {{ buildRouteTable: Function, buildActionIndex: Function, hashFile: Function, scanComponents: Function, analyzeAppElision: Function, checkConventions: Function, projectCheck: Function, readFile: Function }} deps
 */
export function makeToolRunners(deps) {
  const {
    buildRouteTable,
    buildActionIndex,
    hashFile,
    scanComponents,
    analyzeAppElision,
    checkConventions,
    projectCheck,
    readFile,
  } = deps;

  return {
    async list_routes(appDir) {
      const table = await buildRouteTable(appDir);
      // The projection lives in `routes-report.js` so `list_routes` and the CLI
      // `webjs routes --json` stay byte-identical (#975), the same split as
      // `check-report.js` for the `check` tool.
      return projectRoutes(table, { appDir, readFile, extractRouteMethods });
    },

    async list_actions(appDir) {
      // buildActionIndex is a pure file -> hash mapping that imports no module,
      // so this stays truly read-only (no DB init, and no stray stdout
      // from a loaded module corrupting the JSON-RPC channel). The RPC hash is
      // over the file path only, so no module load is needed.
      const idx = await buildActionIndex(appDir, false);
      /** @type {Array<{ file: string, fn: string, endpoint: string, method: string, cache: string|null, tags: boolean, invalidates: boolean, validate: boolean, middleware: boolean }>} */
      const actions = [];
      for (const [file, hash] of idx.fileToHash) {
        let src = '';
        try {
          src = await readFile(file, 'utf8');
        } catch {}
        const names = extractExportNames(src);
        const config = extractActionConfig(src);
        for (const fn of names) {
          // Skip reserved config export names: they are config, not callable actions.
          if (RESERVED_CONFIG.has(fn)) continue;
          actions.push({
            file: relative(appDir, file),
            fn,
            endpoint: `/__webjs/action/${hash}/${fn}`,
            method: config.method,
            cache: config.cache,
            tags: config.tags,
            invalidates: config.invalidates,
            validate: config.validate,
            middleware: config.middleware,
          });
        }
      }
      // Stable order for deterministic output.
      actions.sort((a, b) =>
        a.file === b.file ? a.fn.localeCompare(b.fn) : a.file.localeCompare(b.file),
      );
      return actions;
    },

    async list_components(appDir) {
      const comps = await scanComponents(appDir);
      return comps
        .map((c) => ({
          tag: c.tag,
          file: relative(appDir, c.file),
          className: c.className,
        }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
    },

    async list_elision(appDir) {
      // The whole report IS the contract: `analyzeAppElision` already returns
      // an app-relative, sorted, JSON-serializable object, so unlike
      // `list_routes` there is no projector leaf here and nothing to keep in
      // sync. `webjs elision --json` prints this same object, and a drift test
      // asserts the two are equal.
      return analyzeAppElision(appDir);
    },

    async check(appDir) {
      const violations = await checkConventions(appDir);
      return projectCheck(violations);
    },
  };
}

/**
 * Run the `ui` tool: the @webjsdev/ui kit inventory (no args) or one component's
 * projection (helper signatures + paste-ready example + a11y/description header
 * + deps). Projects the SHARED `@webjsdev/ui/registry/extract` leaf, the same
 * one `webjsui view` renders, so the CLI and MCP cannot drift (#983, the #979
 * shared-projector pattern). `uiDeps` is injected so tests need no real package.
 *
 * @param {{ uiInventory: Function, uiComponent: Function }} uiDeps
 * @param {{ name?: string }} args
 */
/**
 * Resolve the `ui` tool's deps from the shared `@webjsdev/ui/registry/extract`
 * leaf, GUARDED (#983): if `@webjsdev/ui` is absent or too old to carry the
 * `./registry/extract` subpath (a cross-package version skew), only the `ui`
 * tool degrades (its deps throw a clear "unavailable" error, surfaced as an
 * isError tool result) while the rest of the server keeps working. An unguarded
 * top-level import would instead reject during bootstrap and sink the whole
 * server. `importer` is injected so the failure path is unit-testable.
 *
 * @param {() => Promise<{ uiInventory: Function, uiComponent: Function }>} importer
 * @returns {Promise<{ uiInventory: Function, uiComponent: Function }>}
 */
export async function loadUiDeps(importer) {
  try {
    const ui = await importer();
    return { uiInventory: ui.uiInventory, uiComponent: ui.uiComponent };
  } catch {
    const unavailable = () => {
      throw new Error('@webjsdev/ui is not available (install/upgrade @webjsdev/ui to use the ui tool)');
    };
    return { uiInventory: unavailable, uiComponent: unavailable };
  }
}

export function runUiTool(uiDeps, args) {
  const name = typeof args.name === 'string' && args.name ? args.name : null;
  if (!name) return { inventory: uiDeps.uiInventory() };
  const component = uiDeps.uiComponent(name);
  if (!component) {
    throw new Error(`Unknown component "${String(name)}". Call ui with no args for the inventory.`);
  }
  return component;
}

/**
 * A JSON-RPC 2.0 result frame.
 * @param {string|number|null} id
 * @param {any} result
 */
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * A JSON-RPC 2.0 error frame.
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 */
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Run the read-only WebJs MCP server over the given streams. Reads
 * newline-delimited JSON-RPC from `stdin`, writes one response line per request
 * to `stdout`, and logs diagnostics to `stderr` ONLY (stdout is the protocol
 * channel). Resolves when stdin ends (clean shutdown).
 *
 * Injectable streams + `cwd` keep it testable in-process with PassThrough
 * streams; the bin passes the real `process.std*` + `process.cwd()`.
 *
 * @param {{
 *   stdin: NodeJS.ReadableStream,
 *   stdout: NodeJS.WritableStream,
 *   stderr: NodeJS.WritableStream,
 *   cwd: string,
 *   version?: string,
 *   deps?: object,
 * }} opts
 * @returns {Promise<void>}
 */
export async function runMcpServer(opts) {
  const { stdin, stdout, stderr, cwd } = opts;
  const version = opts.version || '0.0.0';

  // Resolve the data functions from @webjsdev/server (reading them is
  // read-only). Injectable for tests so they need not boot the real server.
  let deps = opts.deps;
  if (!deps) {
    const server = await import('@webjsdev/server');
    const check = await import('@webjsdev/server/check');
    const { readFile } = await import('node:fs/promises');
    const { projectCheck } = await import('./check-report.js');
    deps = {
      buildRouteTable: server.buildRouteTable,
      buildActionIndex: server.buildActionIndex,
      hashFile: server.hashFile,
      scanComponents: server.scanComponents,
      analyzeAppElision: server.analyzeAppElision,
      checkConventions: check.checkConventions,
      projectCheck,
      readFile,
    };
  }
  const runners = makeToolRunners(deps);

  // The docs corpus deps for the knowledge layer (#376): resources / prompts /
  // init / docs. Injectable for tests; otherwise resolved from the bundled
  // (published) or repo-root (dev) docs and node fs.
  let docsDeps = opts.docsDeps;
  if (!docsDeps) {
    const loc = resolveDocsLocation(import.meta.url);
    const { readFile } = await import('node:fs/promises');
    const { readdirSync, existsSync } = await import('node:fs');
    docsDeps = {
      docsDir: loc.docsDir,
      agentsPath: loc.agentsPath,
      skillPath: loc.skillPath,
      listDir: readdirSync,
      exists: existsSync,
      readFile,
    };
  }

  // The `source` tool (#378): read the framework's own source from
  // node_modules/@webjsdev/*/src (no-build, so it is the real JSDoc). Roots are
  // resolved once from the server cwd. Injectable for tests.
  let sourceDeps = opts.sourceDeps;
  if (!sourceDeps) {
    const { readFile } = await import('node:fs/promises');
    const { readdirSync, existsSync, realpathSync } = await import('node:fs');
    const readdir = (d) => readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    sourceDeps = {
      roots: resolveFrameworkRoots(cwd, { exists: existsSync }),
      readFile,
      readdir,
      realpath: realpathSync,
    };
  }

  // The `ui` tool (#983): the @webjsdev/ui kit inventory / per-component
  // projection, read from the shared `@webjsdev/ui/registry/extract` leaf.
  // Injectable for tests; otherwise resolved (guarded) from the installed
  // package. See {@link loadUiDeps} for why the import is guarded.
  let uiDeps = opts.uiDeps;
  if (!uiDeps) uiDeps = await loadUiDeps(() => import('@webjsdev/ui/registry/extract'));

  /** Write one JSON-RPC frame as a single line to stdout. */
  const send = (frame) => {
    stdout.write(JSON.stringify(frame) + '\n');
  };
  /** Diagnostics go to stderr only, never stdout. */
  const logErr = (msg) => {
    try { stderr.write(`[webjs mcp] ${msg}\n`); } catch {}
  };

  /**
   * Dispatch one parsed JSON-RPC message. Returns a frame to send, or null
   * for a notification (no `id`) which gets no response.
   */
  const dispatch = async (msg) => {
    const id = msg && Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : null;
    const isNotification = id === null || id === undefined;
    const method = msg && msg.method;

    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'webjs', version },
      });
    }

    // `notifications/initialized` (and any other notification) gets no reply.
    if (isNotification) return null;

    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: TOOL_DEFS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    // Knowledge layer (#376): the framework docs as MCP resources.
    if (method === 'resources/list') {
      return rpcResult(id, { resources: listResources(docsDeps) });
    }
    if (method === 'resources/read') {
      const uri = ((msg && msg.params) || {}).uri;
      try {
        const r = await readResource(docsDeps, uri);
        return rpcResult(id, { contents: [r] });
      } catch (e) {
        return rpcError(id, -32602, e && e.message ? e.message : String(e));
      }
    }

    // Knowledge layer (#376): the recipes as guided-workflow prompts.
    if (method === 'prompts/list') {
      return rpcResult(id, { prompts: PROMPTS });
    }
    if (method === 'prompts/get') {
      const params = (msg && msg.params) || {};
      try {
        return rpcResult(id, getPrompt(params.name, params.arguments));
      } catch (e) {
        return rpcError(id, -32602, e && e.message ? e.message : String(e));
      }
    }

    if (method === 'tools/call') {
      const params = (msg && msg.params) || {};
      const name = params.name;
      const args = params.arguments || {};
      // The knowledge tools route to the docs / source layer; they return text.
      const isKnowledgeTool = name === 'init' || name === 'docs' || name === 'source';
      // `ui` is kit-scoped (not app-scoped), so it is dispatched separately.
      const isUiTool = name === 'ui';
      if (!isKnowledgeTool && !isUiTool && !runners[name]) {
        return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      }
      const appDir = typeof args.appDir === 'string' && args.appDir ? args.appDir : cwd;
      try {
        const result = isKnowledgeTool
          ? name === 'init'
            ? await initText(docsDeps)
            : name === 'docs'
              ? await searchDocs(docsDeps, args)
              : await runSourceTool(sourceDeps, args)
          : isUiTool
            ? runUiTool(uiDeps, args)
            : await runners[name](appDir);
        // Knowledge tools return a markdown string; introspection tools return
        // a JSON-serialisable object.
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return rpcResult(id, {
          content: [{ type: 'text', text }],
        });
      } catch (e) {
        // A tool failure is an MCP tool-result error (isError), not a transport
        // error, so the agent sees the message in the content channel.
        logErr(`tool ${name} failed: ${e && e.message ? e.message : e}`);
        return rpcResult(id, {
          isError: true,
          content: [
            { type: 'text', text: `Error running ${name}: ${e && e.message ? e.message : String(e)}` },
          ],
        });
      }
    }

    return rpcError(id, -32601, `Method not found: ${String(method)}`);
  };

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });

  await new Promise((resolveRun) => {
    // Serialise line handling so responses preserve request order even though
    // dispatch is async.
    let chain = Promise.resolve();
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      chain = chain.then(async () => {
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          // Malformed line: a JSON-RPC parse error, never a crash.
          send(rpcError(null, -32700, 'Parse error'));
          return;
        }
        try {
          const frame = await dispatch(msg);
          if (frame) send(frame);
        } catch (e) {
          logErr(`dispatch error: ${e && e.message ? e.message : e}`);
          const id =
            msg && Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : null;
          send(rpcError(id, -32603, 'Internal error'));
        }
      });
    });
    rl.on('close', () => {
      // Drain the in-flight chain, then resolve (clean shutdown on stdin end).
      chain.then(() => resolveRun()).catch(() => resolveRun());
    });
  });
}
