#!/usr/bin/env node
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveBin } from '../lib/resolve-bin.js';
import { dbGenerateTtyHint } from '../lib/db-hints.js';
import { checkNodeInline, nodeInlineMessage } from '../lib/node-preflight.js';
import { loadAppEnv, resolvePort } from '../lib/port.js';
import { planDevSupervisor } from '../lib/dev-supervisor.js';
import { checkAppName, appNameErrorMessage } from '../lib/app-name.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

// A `--help`/`-h` or `--version`/`-v` request (top-level or after a subcommand)
// must not be gated by the Node-version preflight, so it works on an old Node.
const wantsHelp = cmd === '--help' || cmd === '-h' || rest.includes('--help') || rest.includes('-h');
const wantsVersion = cmd === '--version' || cmd === '-v' || cmd === 'version';

// Node-version preflight (issue #238), INLINE and dependency-free.
// This MUST run before any `import @webjsdev/server`: importing the server
// package links `src/dev.js`, which references Node 24+ builtins, so on an old
// Node that import would LINK-fail before any preflight inside the server
// package could run. The primary guard is therefore `checkNodeInline` (from
// `../lib/node-preflight.js`, which imports nothing), depending only on
// `process.versions.node`. The richer `assertNodeVersion` import inside main()
// stays as belt-and-suspenders for the link-ok (>= 22.13) cases.
// `help` / no-arg / any `--help`|`-h` / `version`|`--version`|`-v` request is
// exempt so a user on an old Node can still read usage and the version.
if (cmd !== 'help' && cmd !== undefined && !wantsHelp && !wantsVersion) {
  let engines = '>=24.0.0';
  try {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    );
    engines = pkg?.engines?.node || engines;
  } catch {}
  const r = checkNodeInline(process.versions.node, engines);
  if (!r.ok) {
    console.error(nodeInlineMessage(r));
    process.exit(1);
  }
}

// Exactly two scaffolds exist. Keep this list as the single source of
// truth. AI-agent docs in README.md / AGENTS.md / .cursorrules /
// .agents/rules/workflow.md / .github/copilot-instructions.md mirror it.
const TEMPLATES = ['full-stack', 'api'];

/**
 * The one thing `webjs elision --verify` must say about its own boundary, in
 * the command's own output rather than only in the docs. The differential masks
 * the JS-loaded set by construction, so it can only ever see the DANGEROUS
 * direction (elision changed the served bytes); a wrongly dropped module shows
 * up as a dead click, which is bytes-identical.
 */
const VERIFY_CAVEAT = `
This proves elision did not change the bytes your app serves. It does NOT prove
post-hydration behaviour: a wrongly dropped module shows up as a dead click, not
as different bytes. Run your browser or e2e suite twice to cover that half:
  WEBJS_ELIDE=1 <your e2e command>
  WEBJS_ELIDE=0 <your e2e command>`;

/**
 * `--routes /a,/b` or `--routes=/a,/b` -> ['/a', '/b']. Every value is
 * normalized to a leading slash; empties drop.
 * @param {string[]} argv
 * @returns {string[]}
 */
function parseRoutesFlag(argv) {
  /** @type {string[]} */
  const raw = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--routes') { if (argv[i + 1]) raw.push(argv[i + 1]); i++; }
    else if (argv[i].startsWith('--routes=')) raw.push(argv[i].slice('--routes='.length));
  }
  return raw
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (v.startsWith('/') ? v : '/' + v));
}

const USAGE = `webjs commands:
  webjs dev   [--port 8080] [--no-hot]            Start dev server with live reload
                                                  (--no-hot: run in-process, no hot-reload supervisor)
  webjs start [--port 8080]                       Start production server (serves source directly, no build step)
  webjs test  [--server|--browser]                 Run server + browser tests
  webjs check [--json]                            Run correctness checks (--json emits structured violations)
  webjs routes [--json|--table] [--no-headers]    Print the route table (path / owner file / methods). Default tree; --json matches the MCP list_routes shape; --no-headers drops the --table header
  webjs elision [--json] [--verify]               Report which component modules are elided and why each shipped one ships;
                                                  --verify diffs SSR output with elision on vs off (exits non-zero on a divergence)
  webjs mcp                                       Start the read-only MCP server (routes / actions / components / elision / check)
  webjs doctor [--json] [--strict]                Verify project health (Node, tsconfig, env, vendor pins, importmap coherence, @webjsdev versions, git hook, page/layout elision, un-versioned stylesheet links).
                                                  --json emits the structured results (with stable codes). --strict additionally fails on every remaining warning.
                                                  Per-check severity is CONFIG: map a code to off/warn/error under "webjs": { "doctor": { "gate": {...} } }
                                                  in package.json, so CI gates on a chosen subset without every warning becoming fatal
  webjs types                                     Generate .webjs/routes.d.ts (typed Route union + per-route params)
  webjs typecheck [tsc args...]                   Type-check the app with the project's tsc --noEmit (non-zero on errors)
  webjs create <name> [--template full-stack|api] [--db sqlite|postgres] [--runtime node|bun] [--no-install]  Scaffold a new webjs app
                                                  <name> must be a valid package name (letters, digits, - . _, starts with a letter or digit)
                                                  (only 2 templates exist. default: full-stack, Drizzle, --db sqlite, --runtime node)
                                                  --runtime bun emits a Bun-flavored app (bun.lock, bun Dockerfile/CI, bun docs);
                                                  also auto-detected when run via "bun create webjs".
                                                  Auto-runs the detected package manager's install in the new dir
                                                  unless --no-install is passed.
  webjs db generate                               Generate a SQL migration from the schema (drizzle-kit generate)
  webjs db migrate                                Apply pending migrations (drizzle-kit migrate)
  webjs db push                                   Push the schema straight to the dev DB (drizzle-kit push)
  webjs db studio                                 Open the database browser (drizzle-kit studio)
  webjs db seed                                   Run the app's db/seed.server.ts
  webjs ui <subcmd>                               AI-first component library CLI
                                                  (init / add / list / view / diff / info)
                                                  Requires @webjsdev/ui installed in the project
  webjs vendor pin [--download]                   Pin client-side npm packages to .webjs/vendor/importmap.json
                                                  Default: writes jspm.io URLs (browser fetches from CDN)
                                                  --download: also downloads bundles for offline production
  webjs vendor unpin <pkg>                        Remove a specific package from the pin file
  webjs vendor list                               Show pinned packages with versions and URLs
  webjs version                                   Print the installed @webjsdev/cli version (also: webjs --version / -v)
  webjs help [command]                            Show this help, or per-command usage + examples (e.g. webjs help routes).
                                                  The flag forms work too: webjs --help / -h for this banner, webjs <command> --help / -h for one command`;

/**
 * Per-command help: usage line, one-line summary, an Options table, and an
 * Examples block (#975). `webjs help <cmd>` (and `webjs <cmd> --help`) renders
 * this so an agent sees the exact flags + worked examples instead of guessing
 * from the one-line USAGE row. Keyed by the top-level command; `db` / `ui` /
 * `vendor` document their subcommand shape. Every entry that takes flags lists
 * them in `options` so the flag surface is machine-readable, matching the Remix
 * CLI's per-command Options section.
 * @type {Record<string, { usage: string, summary: string, options?: Array<{ flag: string, description: string }>, examples: string[] }>}
 */
const HELP = {
  dev: {
    usage: 'webjs dev [--port <n>] [--no-hot]',
    summary: 'Start the dev server with live reload (source is the runtime, no build step).',
    options: [
      { flag: '--port <n>', description: 'Port to listen on (else PORT, else 8080).' },
      { flag: '--no-hot', description: 'Run in-process, without the hot-reload supervisor.' },
    ],
    examples: ['webjs dev', 'webjs dev --port 3000', 'webjs dev --no-hot'],
  },
  start: {
    usage: 'webjs start [--port <n>]',
    summary: 'Start the production server (serves source directly, plain HTTP/1.1).',
    options: [
      { flag: '--port <n>', description: 'Port to listen on (else PORT, else 8080).' },
    ],
    examples: ['webjs start', 'webjs start --port 8080', 'PORT=8080 webjs start'],
  },
  test: {
    usage: 'webjs test [--server] [--browser] [--watch]',
    summary: 'Run the app test suites (server-side node:test and/or browser via web-test-runner).',
    options: [
      { flag: '--server', description: 'Run only the server-side tests.' },
      { flag: '--browser', description: 'Run only the browser tests.' },
      { flag: '--watch', description: 'Re-run on change.' },
    ],
    examples: ['webjs test', 'webjs test --server', 'webjs test --browser --watch'],
  },
  check: {
    usage: 'webjs check [--rules] [--json]',
    summary: 'Run the correctness checks (report-only, no autofix). Exits non-zero on any violation.',
    options: [
      { flag: '--json', description: 'Emit the structured violations + summary as JSON (agent-friendly).' },
      { flag: '--rules', description: 'List the correctness rules instead of running them.' },
    ],
    examples: ['webjs check', 'webjs check --json', 'webjs check --rules'],
  },
  routes: {
    usage: 'webjs routes [--json | --table] [--no-headers]',
    summary: 'Print the route table: each page/route path, its owner file, and (for route handlers) its HTTP methods.',
    options: [
      { flag: '--json', description: 'Emit { pages, apis } as JSON (byte-identical to the MCP list_routes tool).' },
      { flag: '--table', description: 'Flat aligned KIND / PATH / METHODS / FILE columns.' },
      { flag: '--no-headers', description: 'Omit the header row (only with --table); easier to pipe.' },
    ],
    examples: ['webjs routes', 'webjs routes --table', 'webjs routes --table --no-headers', 'webjs routes --json'],
  },
  elision: {
    usage: 'webjs elision [--json] [--verify] [--routes <paths>]',
    summary:
      'Report the elision verdict: which component modules the browser never downloads, and why each one that ships does.',
    options: [
      { flag: '--json', description: 'Emit the verdict as JSON (byte-identical to the MCP list_elision tool).' },
      { flag: '--verify', description: 'Render every static page route with elision on and off and diff the observable SSR bytes. Exits non-zero on a divergence.' },
      { flag: '--routes <paths>', description: 'Comma-separated URL paths to add to the --verify corpus (the only way to cover a dynamic route).' },
    ],
    notesTitle: 'What --verify proves',
    notes: [
      '--verify proves elision did not change the bytes your app serves. It does NOT',
      'prove post-hydration behaviour: a wrongly dropped module shows up as a dead',
      'click, not as different bytes. Run your browser or e2e suite twice',
      '(WEBJS_ELIDE=1 then WEBJS_ELIDE=0) to cover that half.',
    ],
    examples: ['webjs elision', 'webjs elision --json', 'webjs elision --verify', 'webjs elision --verify --routes /,/blog/hello'],
  },
  doctor: {
    usage: 'webjs doctor [--json] [--strict]',
    summary: 'Verify project health. Each result carries a stable code so an agent branches on the failure kind.',
    options: [
      { flag: '--json', description: 'Emit the DoctorResult[] (with stable codes + severities) + a summary as JSON.' },
      { flag: '--strict', description: 'Also fail the exit on EVERY remaining warning, not just hard failures and gated errors.' },
    ],
    notes: [
      'Per-check severity is CONFIG, not a flag. Declare it in package.json under',
      '"webjs": { "doctor": { "gate": { "<CODE>": "off" | "warn" | "error" } } }, so CI',
      'gates on a chosen subset without --strict making every warning fatal. A malformed',
      'gate exits 1 naming it (an unknown code, a bad severity, a non-object doctor/gate,',
      'or a misspelled sibling like "gates"); under --json those come back as a',
      'configErrors array with results empty. A "could not check" result (a network or',
      'toolchain outage) is capped at warn and can never be escalated to error.',
    ],
    examples: ['webjs doctor', 'webjs doctor --json', 'webjs doctor --strict', 'webjs doctor --json --strict'],
  },
  types: {
    usage: 'webjs types',
    summary: 'Generate .webjs/routes.d.ts (the typed Route href union + per-route params).',
    examples: ['webjs types'],
  },
  typecheck: {
    usage: 'webjs typecheck [tsc args...]',
    summary: "Type-check the app with the project's own tsc --noEmit. Extra args pass through to tsc.",
    examples: ['webjs typecheck', 'webjs typecheck --watch'],
  },
  create: {
    usage: 'webjs create <name> [--template full-stack|api] [--db sqlite|postgres] [--runtime node|bun] [--no-install]',
    summary: 'Scaffold a new app. Defaults: full-stack template, Drizzle + SQLite, Node runtime.',
    options: [
      // Kept to one terminal line like every other row: printHelp does not
      // wrap, so a long description renders as one 300-column line.
      {
        flag: '<name>',
        description: 'Package name: letters, digits, - . _ , starts with a letter or digit.',
      },
      { flag: '--template <t>', description: 'full-stack (default) or api (backend-only, no UI).' },
      { flag: '--db <d>', description: 'sqlite (default) or postgres.' },
      { flag: '--runtime <r>', description: 'node (default) or bun.' },
      { flag: '--no-install', description: 'Skip the package-manager install step.' },
    ],
    examples: [
      'webjs create my-app',
      'webjs create my-api --template api',
      'webjs create my-api --template api --db postgres',
      'webjs create my-app --runtime bun',
    ],
  },
  db: {
    usage: 'webjs db <generate|migrate|push|studio|seed>',
    summary: 'Database tasks (wraps drizzle-kit); seed runs db/seed.server.ts.',
    examples: ['webjs db generate', 'webjs db migrate', 'webjs db studio', 'webjs db seed'],
  },
  ui: {
    usage: 'webjs ui <init|add|list|view|diff|info> [names...]',
    summary: 'AI-first component library CLI. Requires @webjsdev/ui installed in the project.',
    examples: ['webjs ui init', 'webjs ui add button card', 'webjs ui list'],
  },
  vendor: {
    usage: 'webjs vendor <pin|unpin|list|audit|outdated|update> [--from <provider>] [--download]',
    summary: 'Pin client-side npm packages into .webjs/vendor/importmap.json.',
    options: [
      { flag: '--from <provider>', description: 'jspm (default), jsdelivr, unpkg, or skypack.' },
      { flag: '--download', description: 'Also download the bundles for offline production (with pin).' },
    ],
    examples: ['webjs vendor pin', 'webjs vendor pin --download', 'webjs vendor list', 'webjs vendor outdated'],
  },
  mcp: {
    usage: 'webjs mcp',
    summary: 'Start the read-only MCP server (routes / actions / components / elision / check + a docs/source knowledge layer).',
    examples: ['webjs mcp'],
  },
  version: {
    usage: 'webjs version',
    summary: 'Print the installed @webjsdev/cli version. Also available as webjs --version / -v.',
    examples: ['webjs version', 'webjs --version'],
  },
};

/**
 * Render `webjs help <cmd>` to stdout: usage, summary, an Options table (when
 * the command takes flags), and Examples, in the Remix-CLI section shape. A
 * universal `-h, --help` option row is appended so every command advertises it.
 * Returns true if the command was found, false otherwise (so the caller can
 * exit non-zero on an unknown help topic, matching the Remix CLI).
 * @param {string} name
 * @returns {boolean}
 */
function printCommandHelp(name) {
  const h = HELP[name];
  if (!h) {
    console.error(`Unknown help topic "${name}".\n`);
    console.error(USAGE);
    return false;
  }
  console.log(`Usage: ${h.usage}\n`);
  console.log(`  ${h.summary}\n`);
  // A command that forwards to an external tool does NOT show webjs's own help
  // for `--help`; word its `-h, --help` row to say so, rather than the generic
  // "Show this help." which would be false for those three commands.
  const tool = HELP_FLAG_PASSTHROUGH_TOOL[name];
  const helpRow = tool
    ? { flag: '-h, --help', description: `Forwarded to ${tool} (this command wraps it).` }
    : { flag: '-h, --help', description: 'Show this help.' };
  const options = [...(h.options || []), helpRow];
  const width = Math.max(...options.map((o) => o.flag.length));
  console.log('Options:');
  for (const o of options) console.log(`  ${o.flag.padEnd(width)}  ${o.description}`);
  // Optional per-command prose for surface a flag table cannot carry (doctor's
  // package.json severity gate is the one that needs it). The heading defaults
  // to `Config:` because that is what doctor's block is and what its help test
  // pins; a command whose prose is not configuration names its own heading
  // (`webjs elision`'s is a caveat about what --verify proves).
  if (h.notes) {
    console.log(`\n${h.notesTitle || 'Config'}:`);
    for (const line of h.notes) console.log(`  ${line}`);
  }
  console.log('\nExamples:');
  for (const ex of h.examples) console.log(`  ${ex}`);
  return true;
}

/**
 * Commands that forward their remaining args to an external CLI, so a trailing
 * `--help` / `-h` should reach THAT tool's own help, not webjs's. Maps the
 * command to the tool it wraps (used both to skip the help-flag intercept and
 * to word the `-h, --help` row in that command's help accurately).
 * @type {Record<string, string>}
 */
const HELP_FLAG_PASSTHROUGH_TOOL = { typecheck: 'tsc', db: 'drizzle-kit', ui: '@webjsdev/ui' };
const HELP_FLAG_PASSTHROUGH = new Set(Object.keys(HELP_FLAG_PASSTHROUGH_TOOL));

/**
 * The installed `@webjsdev/cli` version, read from this package's own
 * package.json. Falls back to `0.0.0` if unreadable (never throws).
 * @returns {string}
 */
function readCliVersion() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** @param {string[]} args */
function flag(args, name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1];
}

/**
 * Run the configured `before` steps (#550) for a phase, aborting the boot on
 * the first failure. The orchestration lives in `lib/run-tasks.js` (pure,
 * unit-tested); this owns the phase-prefixed logging + the non-zero exit (a
 * failed generate/migrate must not serve stale code/schema).
 *
 * @param {string} phase 'dev' | 'start' (for the log line)
 * @param {string[]} steps
 * @param {string} cwd
 */
async function runPhaseBeforeSteps(phase, steps, cwd) {
  const { runBeforeSteps } = await import('../lib/run-tasks.js');
  const r = await runBeforeSteps(steps, cwd, {
    onStep: (step) => console.log(`webjs ${phase}: running before-step \`${step}\`…`),
  });
  if (!r.ok) {
    console.error(`webjs ${phase}: before-step failed (exit ${r.code}): ${r.step}`);
    process.exit(r.code);
  }
}

/**
 * Spawn the configured dev `parallel` tasks (#550) with phase-prefixed logging,
 * delegating the spawn + teardown to `lib/run-tasks.js`'s `startParallelTasks`.
 *
 * @param {string[]} commands
 * @param {string} cwd
 * @returns {Promise<() => void>} the killer
 */
async function startDevParallelTasks(commands, cwd) {
  const { startParallelTasks } = await import('../lib/run-tasks.js');
  return startParallelTasks(commands, cwd, {
    onStart: (cmd) => console.log(`webjs dev: starting parallel task \`${cmd}\`…`),
  });
}

async function main() {
  // `--version` / `-v` (top level): print the installed CLI version and exit.
  if (cmd === '--version' || cmd === '-v') {
    console.log(readCliVersion());
    return;
  }
  // `--help` / `-h` (#975): a top-level flag (webjs --help / -h) prints the
  // banner; the same flag AFTER a subcommand (webjs routes --help) prints that
  // command's help and short-circuits it. Handled before the Node preflight so
  // it works even on an old Node. A command that forwards its args to an
  // external CLI (typecheck/db/ui, in HELP_FLAG_PASSTHROUGH) is skipped so the
  // tool's own --help still reaches it; an UNRECOGNISED command is not
  // intercepted either, so it falls through to the Unknown-command error
  // (exit 1) rather than a silent 0.
  if (cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }
  if (cmd && HELP[cmd] && !HELP_FLAG_PASSTHROUGH.has(cmd) && (rest.includes('--help') || rest.includes('-h'))) {
    printCommandHelp(cmd);
    return;
  }

  // Node preflight: WebJs needs Node 24+ (built-in TS strip + recursive fs.watch).
  // Run before any subcommand so an older Node fails fast with a clear,
  // actionable message naming the found + required version, exiting non-zero
  // instead of crashing cryptically later. `help` / a help or version request
  // is exempt so a user on an old Node can still read usage and the version.
  if (cmd !== 'help' && cmd !== undefined && !wantsHelp && !wantsVersion) {
    const { assertNodeVersion } = await import('@webjsdev/server');
    assertNodeVersion({ onFail: 'exit' });
  }
  // #954: `dev` / `start` need `@webjsdev/core` resolvable FROM the app dir. A
  // fresh git worktree has no node_modules (git worktrees do not copy it), so
  // the app's pages otherwise fail deep in SSR with a raw
  // `ERR_MODULE_NOT_FOUND: Cannot find package '@webjsdev/core'`. Probe up front
  // and surface the cause + remedy instead. No-op (a cheap resolve) when the
  // framework resolves, so the happy-path boot is untouched.
  if (cmd === 'dev' || cmd === 'start') {
    const { checkFrameworkResolves } = await import('../lib/doctor.js');
    const probe = checkFrameworkResolves(process.cwd());
    if (probe.status !== 'pass') {
      console.error(`[webjs] ${probe.message}`);
      if (probe.fix) console.error(`[webjs] Fix: ${probe.fix}`);
      process.exit(1);
    }
  }
  switch (cmd) {
    case 'dev': {
      // If we're already inside the reload child (node --watch or bun --hot),
      // start the server directly.
      if (process.env.__WEBJS_DEV_CHILD === '1') {
        const { startServer } = await import('@webjsdev/server');
        // Load `.env` BEFORE resolving the port so a `PORT` set there is in
        // process.env at resolution time (#447). The server loads `.env`
        // too, but that runs too late to affect the port the CLI computes.
        loadAppEnv(process.cwd());
        const port = resolvePort(flag(rest, '--port'));
        await startServer({ appDir: process.cwd(), port, dev: true });
        break;
      }

      // Run the configured dev orchestration in the PARENT only (#550), so a
      // bare `webjs dev` matches `npm run dev`. `dev.before` (one-shot tasks)
      // runs to completion first; `dev.parallel` (Tailwind's
      // watcher, etc.) then runs as children alongside the server. Spawned once
      // here, NOT in the watch child (which re-execs on every restart). Torn
      // down on exit so a watcher cannot outlive the server.
      const { readAppTasks } = await import('../lib/app-tasks.js');
      const devTasks = readAppTasks(process.cwd());
      // Load `.env` BEFORE the before-steps (same as `start`, L188), so a
      // `dev.before` `webjs db migrate` sees DATABASE_URL from `.env`. Without
      // this a Postgres dev migrate runs with no connection string and fails
      // (sqlite survives via its `?? 'db/dev.db'` config fallback). The watch
      // child / inline server load `.env` again later (idempotent).
      loadAppEnv(process.cwd());
      await runPhaseBeforeSteps('dev', devTasks.dev.before, process.cwd());
      const killTasks = await startDevParallelTasks(devTasks.dev.parallel, process.cwd());
      process.on('SIGINT', () => { killTasks(); process.exit(0); });
      process.on('SIGTERM', () => { killTasks(); process.exit(0); });

      // Decide how to run: in-process (`--no-hot`), or re-exec'd under the host
      // runtime's hot-reload supervisor (`node --watch` on Node, `bun --hot` on
      // Bun, #514). The branch logic lives in the pure `planDevSupervisor` so it
      // is unit-testable without spawning a process.
      const { existsSync } = await import('node:fs');
      const plan = planDevSupervisor({
        isBun: !!process.versions.bun,
        argv: process.argv.slice(1),
        noHot: rest.includes('--no-hot'),
        exists: (p) => existsSync(p),
      });

      if (plan.mode === 'inline') {
        const { startServer } = await import('@webjsdev/server');
        loadAppEnv(process.cwd());
        const port = resolvePort(flag(rest, '--port'));
        await startServer({ appDir: process.cwd(), port, dev: true });
        killTasks();
        break;
      }

      const child = spawn(process.execPath, plan.args, {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env, __WEBJS_DEV_CHILD: '1' },
      });
      child.on('exit', (code) => { killTasks(); process.exit(code ?? 0); });
      break;
    }
    case 'start': {
      const { startServer } = await import('@webjsdev/server');
      // Load `.env` BEFORE resolving the port so a `PORT` set there wins over
      // the 8080 default (#447), same as for `dev`.
      loadAppEnv(process.cwd());
      // Run the configured `start.before` steps (e.g. `webjs db migrate`)
      // before serving (#550), so a bare `webjs start` is not a degraded run
      // that skips the `prestart` hook. Aborts the boot on a failed step.
      const { readAppTasks } = await import('../lib/app-tasks.js');
      await runPhaseBeforeSteps('start', readAppTasks(process.cwd()).start.before, process.cwd());
      const port = resolvePort(flag(rest, '--port'));
      await startServer({ appDir: process.cwd(), port, dev: false });
      break;
    }
    case 'db': {
      const sub = rest[0];
      const args = rest.slice(1);
      // `webjs db seed` runs the app's own seed script directly (not a
      // drizzle-kit command); Drizzle has no codegen, so there is no
      // `generate`-the-client step, only schema-to-SQL `generate`.
      if (sub === 'seed') {
        const { existsSync } = await import('node:fs');
        const seedFile = ['db/seed.server.ts', 'db/seed.server.js']
          .map((p) => join(process.cwd(), p)).find(existsSync);
        if (!seedFile) {
          console.error('No db/seed.server.ts found in this app.');
          process.exit(1);
        }
        const child = spawn(process.execPath, [seedFile], { stdio: 'inherit', cwd: process.cwd() });
        child.on('exit', (code) => process.exit(code ?? 0));
        break;
      }
      // generate (schema -> SQL migration), migrate (apply), push (dev
      // schema sync), studio. All wrap drizzle-kit; the verbose name stays
      // hidden behind `webjs db`.
      const map = { generate: ['generate'], migrate: ['migrate'], push: ['push'], studio: ['studio'] };
      const kitArgs = map[sub];
      if (!kitArgs) { console.error('Unknown db subcommand.\n' + USAGE); process.exit(1); }
      // Resolve the app's own drizzle-kit bin and spawn it with the CURRENT
      // runtime (process.execPath). This drops the hard `npx` dependency (#570):
      // `npx` is absent in a pure oven/bun image, which broke `webjs db migrate`
      // at boot. On Node this is `node drizzle-kit`, on Bun `bun drizzle-kit`
      // (drizzle-kit runs under both).
      let dkPath;
      try {
        dkPath = resolveBin(process.cwd(), 'drizzle-kit', 'drizzle-kit');
      } catch {
        console.error(
          'webjs db: drizzle-kit is not installed in this project.\n' +
          'Install it with `npm install -D drizzle-kit`, then re-run `webjs db ' + sub + '`.',
        );
        process.exit(1);
      }
      // For `generate` off a non-TTY, capture stderr (teed straight through) so
      // the rename-prompt dead-end can be detected: drizzle-kit reports it on
      // stderr but exits 0, so the exit code is useless. Every other case keeps
      // plain inherit, and an interactive terminal still answers the prompt.
      const captureStderr = sub === 'generate' && !process.stdin.isTTY;
      const child = spawn(process.execPath, [dkPath, ...kitArgs, ...args], {
        stdio: captureStderr ? ['inherit', 'inherit', 'pipe'] : 'inherit',
        cwd: process.cwd(),
      });
      let errText = '';
      if (captureStderr && child.stderr) {
        child.stderr.on('data', (chunk) => { errText += chunk; process.stderr.write(chunk); });
      }
      // Read the captured stderr on `close`, NOT `exit`: `exit` can fire before
      // the stderr pipe has drained its final chunk, which would miss the prompt
      // signature (and tee the raw error AFTER the hint). `close` fires once all
      // stdio has flushed, and still carries the exit code.
      child.on('close', (code) => {
        // Surface the escape hatch when `generate` dead-ends on a rename prompt
        // with no TTY, instead of leaving the raw drizzle-kit error as the last
        // word. Interactive and successful runs print nothing extra.
        const hint = dbGenerateTtyHint(sub, process.stdin.isTTY, errText);
        if (hint) console.error(hint);
        process.exit(code ?? 0);
      });
      break;
    }
    case 'ui': {
      // Delegate to @webjsdev/ui's bin. It is a hard dependency of
      // @webjsdev/cli, so `npm install -g webjsdev` pulls it in automatically
      // and `webjs ui add button` works without an extra install.
      //
      // Resolve via resolveBin, NOT req.resolve('@webjsdev/ui/bin/webjsui.js'):
      // the ui package's `exports` map does not list the bin subpath, so a
      // direct subpath resolve throws ERR_PACKAGE_PATH_NOT_EXPORTED even though
      // the file exists, which surfaced as a misleading "could not be resolved"
      // (#1073). resolveBin resolves the `.` export, walks to the package root,
      // and reads the `bin` map, exactly as `db` / `test --browser` do.
      let entry;
      try {
        // Hard-dep path: @webjsdev/ui in the CLI's own node_modules.
        entry = resolveBin(join(__dirname, '..'), '@webjsdev/ui', 'webjsui');
      } catch {
        // Fallback: the user installed @webjsdev/ui directly in their project.
        try {
          entry = resolveBin(process.cwd(), '@webjsdev/ui', 'webjsui');
        } catch {
          console.error('@webjsdev/ui could not be resolved.');
          console.error('Reinstall the CLI:  npm install -g webjsdev');
          process.exit(1);
        }
      }
      const child = spawn(process.execPath, [entry, ...rest], { stdio: 'inherit', cwd: process.cwd() });
      child.on('exit', (code) => process.exit(code ?? 0));
      break;
    }
    case 'test': {
      const cwd = process.cwd();
      const { existsSync } = await import('node:fs');

      // Two test runners:
      //   1. node:test for server-side tests (test/server/*.test.ts, test/unit/*.test.ts)
      //   2. WTR + Playwright for browser tests (test/browser/*.test.js)
      //
      // `webjs test`          → runs both
      // `webjs test --server` → server tests only (node:test)
      // `webjs test --browser` → browser tests only (WTR + Playwright)

      const serverOnly = rest.includes('--server');
      const browserOnly = rest.includes('--browser');
      const runServer = !browserOnly;
      const runBrowser = !serverOnly;

      // --- Server tests (node:test) ---
      if (runServer) {
        const { readdir } = await import('node:fs/promises');
        const testFiles = [];

        // Walk test/ recursively so the documented feature-folder layout
        // (test/<feature>/<name>.test.ts) is discovered, not just files
        // sitting directly in test/. Two kinds are NOT run here:
        //   - **/browser/**  → real-browser tests, owned by WTR below.
        //   - **/e2e/**      → full-app boot, opt-in via WEBJS_E2E=1 (the
        //                      documented "WEBJS_E2E=1 webjs test adds the
        //                      e2e tests" semantics).
        const runE2E = !!process.env.WEBJS_E2E;
        const walk = async (dir, segments) => {
          let entries;
          try { entries = await readdir(dir, { withFileTypes: true }); }
          catch { return; }
          for (const ent of entries) {
            if (ent.name === 'node_modules') continue;
            const full = join(dir, ent.name);
            if (ent.isDirectory()) {
              if (ent.name === 'browser') continue;
              if (ent.name === 'e2e' && !runE2E) continue;
              await walk(full, [...segments, ent.name]);
            } else if (/\.test\.(js|ts|mjs|mts)$/.test(ent.name)) {
              if (!testFiles.includes(full)) testFiles.push(full);
            }
          }
        };
        await walk(join(cwd, 'test'), []);

        if (testFiles.length > 0) {
          console.log(`webjs test: running ${testFiles.length} server test file(s)…\n`);
          // Dispatch to the current runtime's test runner (#570). Node uses
          // `node --test <files>`; Bun's runner is the `bun test <files>`
          // subcommand (`bun --test` is invalid). process.execPath is the
          // active runtime, so the args differ but the runner is native to it.
          const testArgs = process.versions.bun
            ? ['test', ...testFiles]
            : ['--test', ...testFiles];
          const child = spawn(process.execPath, testArgs, {
            stdio: 'inherit', cwd, env: { ...process.env },
          });
          const code = await new Promise(r => child.on('exit', r));
          if (code !== 0) process.exit(code ?? 1);
        }
      }

      // --- Browser tests (WTR + Playwright) ---
      if (runBrowser) {
        const hasConfig = existsSync(join(cwd, 'web-test-runner.config.js'))
          || existsSync(join(cwd, 'web-test-runner.config.mjs'));
        // Fall back to the test/browser dir only when there is no explicit config.
        const useBrowserDir = !hasConfig && !serverOnly && existsSync(join(cwd, 'test', 'browser'));
        // Only resolve + run when there is actually something to run, so a
        // `webjs test` with no browser tests stays a no-op (not a hard error).
        if (hasConfig || useBrowserDir) {
          // Resolve the app's @web/test-runner bin and spawn it with the current
          // runtime, dropping `npx` (#570; absent in a pure oven/bun image).
          let wtrPath;
          try {
            wtrPath = resolveBin(cwd, '@web/test-runner', 'wtr');
          } catch {
            console.error(
              '\nwebjs test --browser: @web/test-runner is not installed in this project.\n' +
              'Install it with `npm install -D @web/test-runner @web/test-runner-playwright`.',
            );
            process.exit(1);
          }
          console.log(`\nwebjs test: running browser tests (WTR + Playwright)…\n`);
          const wtrArgs = hasConfig ? [wtrPath] : [wtrPath, '--files', 'test/browser/**/*.test.js'];
          const child = spawn(process.execPath, wtrArgs, {
            stdio: 'inherit', cwd, env: { ...process.env },
          });
          const code = await new Promise(r => child.on('exit', r));
          if (code !== 0) process.exit(code ?? 1);
        }
      }

      console.log('\nwebjs test: done ✓');
      break;
    }
    case 'check': {
      const { checkConventions, RULES } = await import('@webjsdev/server/check');

      if (rest.includes('--rules')) {
        console.log('webjs check, correctness rules:');
        console.log('  Every rule catches code that is wrong to ship: a crash, a');
        console.log('  security leak, a reactive prop that silently stops');
        console.log('  re-rendering, or a build/type-strip failure. They always');
        console.log('  run. Project conventions (layout, style, process) are');
        console.log('  guidance in CONVENTIONS.md, not rules here.\n');
        for (const r of RULES) {
          console.log(`  ${r.name.padEnd(30)} ${r.description}`);
        }
        break;
      }

      const violations = await checkConventions(process.cwd());

      // --json emits the raw structured violations + a summary count as JSON,
      // so an agent running `webjs check` in a loop consumes structured data
      // instead of regex-scraping stdout. The shared projector keeps this byte-
      // identical to the MCP `check` tool. The non-zero exit on violations is
      // preserved (an agent gates on the exit code AND parses the report).
      if (rest.includes('--json')) {
        // The projector lives in @webjsdev/mcp (the MCP `check` tool's home),
        // so `check --json` and the MCP tool stay byte-identical (#415).
        const { projectCheck } = await import('@webjsdev/mcp/check-report');
        console.log(JSON.stringify(projectCheck(violations)));
        if (violations.length > 0) process.exit(1);
        break;
      }

      if (violations.length === 0) {
        console.log('webjs check: all checks pass ✓');
      } else {
        console.log(`webjs check: ${violations.length} violation(s) found\n`);
        for (const v of violations) {
          console.log(`  ✗ [${v.rule}] ${v.file}`);
          console.log(`    ${v.message}`);
          if (v.fix) console.log(`    Fix: ${v.fix}`);
          console.log();
        }
        process.exit(1);
      }
      break;
    }
    case 'doctor': {
      // Project-health checklist (#266). The checks are PURE (in lib/doctor.js);
      // this branch only renders them and owns the exit code. The exit is
      // non-zero when a HARD check FAILS or when a check the app gated `error`
      // reports something; an UNGATED warn stays informational (env drift / pin
      // staleness / version drift are the app's concern, not a broken
      // toolchain). An app declares per-check severity
      // in its package.json `webjs.doctor.gate` (#1257), which is what lets CI
      // gate on a chosen subset without `--strict` making every warning fatal.
      const { runDoctorChecks, readDoctorPolicy, applyDoctorPolicy, DOCTOR_CODES, DOCTOR_SEVERITIES } =
        await import('../lib/doctor.js');
      const appDir = process.cwd();
      const strict = rest.includes('--strict');
      const asJson = rest.includes('--json');

      // Read the policy FIRST. A wrong shape, a key that is not a known code, or
      // a value that is not a severity exits 1 without running the checks: a
      // typo silently ignored would leave CI un-gated while looking gated,
      // which is the worst failure a mechanism like this can have.
      const policy = readDoctorPolicy(appDir);
      const configErrors = [
        ...policy.malformed.map(({ path, value }) => ({ kind: 'malformed', path, value })),
        ...policy.unknownKeys.map((path) => ({ kind: 'unknown-key', path })),
        ...policy.unknownCodes.map((code) => ({ kind: 'unknown-code', code })),
        ...policy.badSeverities.map(({ code, value }) => ({ kind: 'bad-severity', code, value })),
      ];
      if (configErrors.length > 0) {
        if (asJson) {
          console.log(JSON.stringify({
            results: [],
            summary: { pass: 0, warn: 0, fail: 0, off: 0, strict, ok: false },
            configErrors,
          }));
          process.exit(1);
        }
        // Header names the BLOCK, not `gate`: two of the four error kinds are
        // about `webjs.doctor` itself or a misspelled sibling, so naming `gate`
        // would point at a key the package.json may not even contain.
        console.error('webjs doctor: invalid "webjs.doctor" config in package.json\n');
        for (const e of configErrors) {
          if (e.kind === 'malformed') console.error(`  Expected an object at ${e.path}, got ${JSON.stringify(e.value)}`);
          else if (e.kind === 'unknown-key') console.error(`  Unknown config key: ${e.path} (the only key is "gate")`);
          else if (e.kind === 'unknown-code') console.error(`  Unknown check code: ${e.code}`);
          else console.error(`  Invalid severity for ${e.code}: ${JSON.stringify(e.value)}`);
        }
        console.error('\n  Shape: "webjs": { "doctor": { "gate": { "<CODE>": "<severity>" } } }');
        console.error(`  Valid severities: ${DOCTOR_SEVERITIES.join(' / ')}`);
        console.error(`  Valid codes: ${Object.values(DOCTOR_CODES).join(', ')}`);
        process.exit(1);
      }

      const results = applyDoctorPolicy(await runDoctorChecks(appDir), policy.gate);
      // Counts come off the EFFECTIVE severity, not the raw status, so a gated
      // code lands in the bucket the app asked for. With no gate the two are
      // identical (a `fail` defaults to `error`, a `warn` to `warn`), which is
      // what keeps an un-configured app byte-identical to before.
      const counts = results.reduce((acc, r) => {
        acc[r.severity] = (acc[r.severity] || 0) + 1;
        return acc;
      }, /** @type {Record<string, number>} */ ({}));
      const pass = counts.pass || 0;
      const warn = counts.warn || 0;
      const fail = counts.error || 0;
      const off = counts.off || 0;
      // `--strict` additionally fails the exit on every REMAINING warning, so an
      // agent can gate on a fully-clean toolchain (drift / staleness / pin freshness) in a fix loop,
      // not just on a hard toolchain break. Without it, a warn is fatal only
      // where the app gated its code `error`, which folded into `fail` above.
      const failing = fail > 0 || (strict && warn > 0);

      // --json emits the raw DoctorResult[] (each carries a stable `code` and
      // its effective `severity`) plus a summary, so an agent consumes
      // structured data instead of scraping the text. Shape mirrors `check
      // --json`: a top-level array-bearing object with a `summary` count. The
      // non-zero exit is preserved (an agent gates on the exit code AND parses
      // the report).
      if (asJson) {
        console.log(JSON.stringify({
          results,
          summary: { pass, warn, fail, off, strict, ok: !failing },
        }));
        if (failing) process.exit(1);
        break;
      }

      const marker = { pass: '[pass]', off: '[off]', warn: '[warn]', error: '[fail]' };
      console.log('webjs doctor: project-health checklist\n');
      for (const r of results) {
        // Name the gate whenever it moved a result off its default, so the
        // reason a warning is fatal (or silenced) is on the line itself.
        const dflt = r.status === 'fail' ? 'error' : 'warn';
        const gated = r.status !== 'pass' && r.severity !== dflt ? `, gated: ${r.severity}` : '';
        console.log(`  ${marker[r.severity]} ${r.name} (${r.code}${gated})`);
        // A silenced check reports NOTHING beyond its name: an app that gated a
        // code `off` asked not to hear about it, and printing the finding plus
        // a Fix line every run is exactly the noise it turned off (ESLint's
        // `off` drops the message too). The checklist still lists it as [off]
        // and the summary still counts it, so a silenced check is never
        // invisible, and `--json` keeps the whole result for tooling.
        if (r.severity !== 'off') {
          console.log(`    ${r.message}`);
          if (r.fix && r.status !== 'pass') console.log(`    Fix: ${r.fix}`);
        }
        console.log();
      }
      console.log(`  ${pass} passed, ${warn} warning(s), ${fail} failed${off > 0 ? `, ${off} silenced` : ''}.`);
      if (failing) {
        const reason = fail > 0
          ? `${fail} check(s) failed. Fix the issue(s) above, or adjust "webjs.doctor.gate" in package.json.`
          : `${warn} warning(s) found and --strict was set.`;
        console.error(`\nwebjs doctor: ${reason}`);
        process.exit(1);
      }
      break;
    }
    case 'routes': {
      // Print the app route table to stdout (#975): every page (path, owner
      // file, dynamic params) and every route.{js,ts} API handler (path, owner
      // file, HTTP methods). Reuses the ONE route walker (`buildRouteTable`, the
      // same walk that backs `webjs types` and the dev server) and the shared
      // `projectRoutes` projector, so `--json` is byte-identical to the MCP
      // `list_routes` tool. Read-only: no module load, no autofix.
      const { buildRouteTable } = await import('@webjsdev/server');
      const { projectRoutes } = await import('@webjsdev/mcp/routes-report');
      const { extractRouteMethods } = await import('@webjsdev/mcp');
      const { readFile } = await import('node:fs/promises');
      const appDir = process.cwd();
      const table = await buildRouteTable(appDir);
      const report = await projectRoutes(table, { appDir, readFile, extractRouteMethods });

      // --json: the machine contract, identical to the MCP `list_routes` shape.
      if (rest.includes('--json')) {
        console.log(JSON.stringify(report));
        break;
      }

      const { pages, apis } = report;
      // A page is reached via GET (its server render); a route.{js,ts} exposes
      // exactly its exported verbs. Present both as one path -> methods -> file
      // view. Dynamic pages append their param names.
      const pageMethods = 'GET';

      // --table: flat, aligned columns (KIND / PATH / METHODS / FILE), the
      // easiest shape for an agent to scan or a human to grep. `--no-headers`
      // drops the header row so the output pipes cleanly into awk/cut.
      if (rest.includes('--table')) {
        /** @type {Array<[string,string,string,string]>} */
        const rows = [];
        if (!rest.includes('--no-headers')) rows.push(['KIND', 'PATH', 'METHODS', 'FILE']);
        for (const p of pages) {
          rows.push(['page', p.path + (p.params ? ` [${p.params.join(', ')}]` : ''), pageMethods, p.file]);
        }
        for (const a of apis) {
          rows.push(['api', a.path, a.methods.join(', ') || '(none)', a.file]);
        }
        // With --no-headers and no routes there are no rows; nothing to print.
        if (rows.length === 0) break;
        const widths = [0, 1, 2].map((c) => Math.max(...rows.map((r) => r[c].length)));
        for (const r of rows) {
          console.log(
            `${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`,
          );
        }
        break;
      }

      // Default: a grouped tree.
      console.log(`webjs routes: ${pages.length} page(s), ${apis.length} API route(s)\n`);
      if (pages.length) {
        console.log('Pages');
        const pathW = Math.max(...pages.map((p) => p.path.length));
        for (const p of pages) {
          const params = p.params ? `  ${p.params.map((n) => `[${n}]`).join(' ')}` : '';
          console.log(`  ${p.path.padEnd(pathW)}  ${p.file}${params}`);
        }
        console.log();
      }
      if (apis.length) {
        console.log('API routes');
        const pathW = Math.max(...apis.map((a) => a.path.length));
        const methW = Math.max(...apis.map((a) => (a.methods.join(', ') || '(none)').length));
        for (const a of apis) {
          const methods = a.methods.join(', ') || '(none)';
          console.log(`  ${a.path.padEnd(pathW)}  ${methods.padEnd(methW)}  ${a.file}`);
        }
        console.log();
      }
      if (!pages.length && !apis.length) {
        console.log('  No routes found. Add an app/page.ts or an app/**/route.ts.');
      }
      break;
    }
    case 'elision': {
      // Report the elision verdict for the app in cwd (#1308): which component
      // modules the browser never downloads, why each one that ships does,
      // which page/layout is inert / import-only / ships whole, and any orphan
      // class that gets no verdict at all. Reuses the ONE analysis pass
      // (`analyzeAppElision`, the same reporting layer `webjs doctor` and
      // the MCP `list_elision` tool call), so `--json` is byte-identical to
      // that tool. Read-only: no autofix, and nothing is written to disk.
      const appDir = process.cwd();

      // --verify: the app-level differential. Renders every static page route
      // with elision ON and OFF in this one process and diffs the observable
      // SSR bytes, which is literally the framework's own guard
      // (`packages/server/test/elision/differential-elision.test.js`) pointed
      // at an arbitrary app's route table.
      if (rest.includes('--verify')) {
        const { createRequestHandler, buildRouteTable, maskJsSet, staticPageRoutes } =
          await import('@webjsdev/server');

        const extra = parseRoutesFlag(rest);
        let table;
        try {
          table = await buildRouteTable(appDir);
        } catch (err) {
          console.error(`webjs elision --verify: cannot read the route table here (${err && err.message}).`);
          process.exit(1);
        }
        const staticRoutes = staticPageRoutes(table);
        const dynamic = (table.pages || [])
          .filter((r) => r.paramNames && r.paramNames.length)
          .map((r) => (r.routeDir && r.routeDir !== '.' ? '/' + r.routeDir : '/'))
          .sort();
        // An extra route the author named explicitly is REQUIRED to render; a
        // static one that does not is merely reported (a page may legitimately
        // throw notFound() for every visitor).
        const required = new Set(extra);
        const routes = [...new Set([...staticRoutes, ...extra])];

        // The app's access log would drown the verdict, and a verification
        // run is not a server: keep errors (a real boot failure must surface)
        // and drop the per-request info lines.
        const quiet = { info: () => {}, warn: () => {}, debug: () => {}, error: (...a) => console.error(...a) };

        const capture = async (h, r) => {
          const resp = await h.handle(new Request('http://localhost' + r));
          return { status: resp.status, html: await resp.text() };
        };
        // The module URLs a response preloads, with the content-hash query
        // stripped. Comparing the two sides' sets is how the run reports what
        // elision actually DROPPED, which is the only thing that distinguishes
        // a real pass from two identical renders.
        const preloadSet = (html) => new Set(
          [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1].split('?')[0]),
        );

        const ORIG = process.env.WEBJS_ELIDE;
        /** @type {Record<string, {status:number, html:string}>} */
        const onA = {}, onB = {}, off = {};
        try {
          // Elision ON, FORCED. Deleting the override would only fall back to
          // `webjs.elide`, so on an app that opts out this side would run with
          // elision OFF too and the command would compare two identical renders
          // and report them "identical with elision on vs off", which is false
          // about a run where elision was never on. The env override wins over
          // the config key, which is exactly what makes it the right seam here.
          // Warm fully so the memoized verdict is locked before the env flips
          // for the second handler.
          process.env.WEBJS_ELIDE = '1';
          const hOn = await createRequestHandler({ appDir, dev: false, logger: quiet });
          if (hOn.warmup) await hOn.warmup();
          for (const r of routes) onA[r] = await capture(hOn, r);
          // A SECOND capture through the same warm handler. A route whose two
          // ON captures already differ is nondeterministic (live data, a random
          // id, a clock the masker does not normalize), so a differential over
          // it proves nothing and reporting it as a failure would be a red the
          // author cannot act on. The framework's own test needs no such pass
          // because its corpus is fixed and known; an arbitrary app's is not.
          for (const r of routes) onB[r] = await capture(hOn, r);
          // Elision OFF via the env override; a fresh handler reads it on its
          // own first warm.
          process.env.WEBJS_ELIDE = '0';
          const hOff = await createRequestHandler({ appDir, dev: false, logger: quiet });
          if (hOff.warmup) await hOff.warmup();
          for (const r of routes) off[r] = await capture(hOff, r);
        } catch (err) {
          console.error(`webjs elision --verify: could not boot the app (${err && err.message}).`);
          process.exit(1);
        } finally {
          if (ORIG === undefined) delete process.env.WEBJS_ELIDE;
          else process.env.WEBJS_ELIDE = ORIG;
        }

        const unrenderable = [], nondeterministic = [], diverged = [];
        /** @type {Set<string>} modules the OFF side preloads and the ON side does not */
        const dropped = new Set();
        let compared = 0;
        for (const r of routes) {
          if (onA[r].status >= 400) { unrenderable.push(`${r} (${onA[r].status})`); continue; }
          if (maskJsSet(onA[r].html) !== maskJsSet(onB[r].html)) { nondeterministic.push(r); continue; }
          compared++;
          // What elision removed on this route. A pass over a corpus where this
          // stays empty is TRUE but trivially so, and the author needs to see
          // that rather than read it as proof elision was exercised.
          const onSet = preloadSet(onA[r].html);
          for (const u of preloadSet(off[r].html)) if (!onSet.has(u)) dropped.add(u);
          const a = maskJsSet(onA[r].html);
          const b = maskJsSet(off[r].html);
          if (onA[r].status !== off[r].status) {
            diverged.push({ route: r, kind: 'status', a: String(onA[r].status), b: String(off[r].status), at: 0 });
            continue;
          }
          if (a !== b) {
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            diverged.push({
              route: r, kind: 'body', at: i,
              a: a.slice(Math.max(0, i - 40), i + 40),
              b: b.slice(Math.max(0, i - 40), i + 40),
            });
          }
        }

        for (const d of diverged) {
          console.error(
            d.kind === 'status'
              ? `FAIL ${d.route}: status differs with elision on vs off (on=${d.a}, off=${d.b})`
              : `FAIL ${d.route}: elision changed observable output near offset ${d.at}\n` +
                `  ON : ...${JSON.stringify(d.a)}\n  OFF: ...${JSON.stringify(d.b)}`,
          );
        }
        const badRequired = unrenderable.filter((u) => required.has(u.split(' ')[0]));
        for (const u of badRequired) console.error(`FAIL ${u}: a --routes path must render`);

        const skips = [
          dynamic.length ? `${dynamic.length} skipped (dynamic: ${dynamic.join(', ')})` : '0 skipped (dynamic)',
          `${nondeterministic.length} skipped (nondeterministic${nondeterministic.length ? ': ' + nondeterministic.join(', ') : ''})`,
        ];
        if (unrenderable.length) skips.push(`${unrenderable.length} skipped (did not render: ${unrenderable.join(', ')})`);

        if (diverged.length || badRequired.length) {
          console.error(`\nwebjs elision --verify: ${diverged.length} route(s) diverged out of ${compared} compared.`);
          process.exit(1);
        }
        if (compared === 0) {
          // A vacuous pass is a failure, the same posture scripts/run-bun-tests.js
          // takes for a run that executed zero tests.
          console.error(
            `webjs elision --verify: nothing was compared (${skips.join(', ')}).\n` +
            'Pass --routes /a,/b to name renderable paths, or add a static page route.',
          );
          process.exit(1);
        }
        console.log(
          `webjs elision --verify: ${compared} route(s) identical with elision on vs off, ${skips.join(', ')}.\n` +
          (dropped.size
            ? `Elision dropped ${dropped.size} module(s) across that corpus, so the comparison was a real one.`
            : 'Elision dropped NO modules across that corpus, so the two sides were identical by construction '
              + 'and this run proves nothing about elision. Nothing on these routes was elidable; run '
              + '`webjs elision` to see why.'),
        );
        console.log(VERIFY_CAVEAT);
        break;
      }

      const { analyzeAppElision } = await import('@webjsdev/server');
      const report = await analyzeAppElision(appDir);

      // --json: the machine contract, identical to the MCP `list_elision` shape.
      if (rest.includes('--json')) {
        console.log(JSON.stringify(report));
        break;
      }

      if (!report.analysed) {
        const why = {
          'no-app': 'no app/ directory here, so there is nothing to analyse',
          'elide-off': 'elision is disabled (webjs.elide false, or WEBJS_ELIDE), so every module ships',
          unanalysable: 'the app could not be analysed (`webjs check` and `webjs dev` name the real problem)',
        }[report.skipped] || 'nothing was analysed';
        console.log(`webjs elision: ${why}.`);
        break;
      }

      const s = report.summary;
      console.log(
        `webjs elision: ${s.components} component module(s), ${s.elided} elided, ${s.shipped} shipped. ` +
        `${s.routeModules} route module(s): ${s.inert} inert, ${s.importOnly} import-only, ${s.shippedWhole} ship whole.\n`,
      );

      const elided = report.components.filter((c) => c.verdict === 'elided');
      const shipped = report.components.filter((c) => c.verdict === 'shipped');
      // Column width, capped so one outlier does not push every other row off
      // the terminal. An over-long cell overflows its own row rather than
      // widening the table. The FILE column gets the generous cap because a
      // module path is what a reader scans by; the tag column gets the tight
      // one because a file registering five tags is the rare case.
      const pad = (rows, col, cap) => Math.min(cap, Math.max(0, ...rows.map((r) => r[col].length)));
      const FILE_W = 58, TAG_W = 30;

      if (elided.length) {
        console.log('Elided components (the browser never downloads these)');
        const rows = elided.map((c) => [c.file, c.tags.join(', ')]);
        const w = pad(rows, 0, FILE_W);
        for (const [file, tags] of rows) console.log(`  ${file.padEnd(w)}  ${tags}`.trimEnd());
        console.log();
      }
      if (shipped.length) {
        console.log('Shipped components (and the evidence that forced each one)');
        const rows = shipped.map((c) => [c.file, c.tags.join(', '), `${c.evidence || 'unknown'}: ${c.reason || 'no evidence recorded'}`]);
        const w0 = pad(rows, 0, FILE_W), w1 = pad(rows, 1, TAG_W);
        for (const [file, tags, why] of rows) console.log(`  ${file.padEnd(w0)}  ${tags.padEnd(w1)}  ${why}`.trimEnd());
        console.log();
      }
      if (report.routeModules.length) {
        console.log('Route modules');
        const rows = report.routeModules.map((r) => [
          r.verdict, r.file,
          r.verdict === 'import-only' ? `emits ${r.emits.join(', ') || '(nothing)'}`
            : r.verdict === 'shipped' ? (r.blocker ? `blocked by ${r.blocker}, which ${r.reason}` : `it ${r.reason}`)
            : '',
        ]);
        const w0 = pad(rows, 0, 12), w1 = pad(rows, 1, FILE_W);
        for (const [verdict, file, note] of rows) {
          console.log(`  ${verdict.padEnd(w0)}  ${file.padEnd(w1)}${note ? '  ' + note : ''}`.trimEnd());
        }
        console.log();
      }
      if (report.orphans.length) {
        console.log('Orphan components (dropped with NO verdict; `static interactive = true` cannot rescue these)');
        for (const o of report.orphans) {
          console.log(`  ${o.className} in ${o.file} registers no literal tag, so the component scanner never sees it`);
        }
        console.log('  Fix: pass a literal tag to Class.register(\'my-tag\') (invariant 3 already requires one).');
        console.log();
      }
      if (!report.components.length && !report.routeModules.length) {
        console.log('  Nothing to report. Add a component or a page under app/.');
      }
      break;
    }
    case 'types': {
      // Generate `.webjs/routes.d.ts` from the app's `app/` routes (#258),
      // narrowing the @webjsdev/core `Route` href union + per-route `params`.
      // Opt-in codegen: the static types in @webjsdev/core work without it
      // (un-generated apps see `Route = string`).
      const { generateRouteTypes } = await import('@webjsdev/server');
      const { mkdir, writeFile } = await import('node:fs/promises');
      const appDir = process.cwd();
      const text = await generateRouteTypes(appDir);
      const outDir = join(appDir, '.webjs');
      await mkdir(outDir, { recursive: true });
      const outFile = join(outDir, 'routes.d.ts');
      await writeFile(outFile, text);
      // Count the typed routes (each `WebjsRoutes` key is one route literal).
      const count = (text.match(/^\s+".*": true;$/gm) || []).length;
      console.log(
        `webjs types: wrote .webjs/routes.d.ts (${count} route${count === 1 ? '' : 's'} typed). ` +
        `Ensure tsconfig "include" lists ".webjs/routes.d.ts" so tsserver picks it up.`,
      );
      break;
    }
    case 'typecheck': {
      // Type-check the app with the project's OWN tsc (it reads the app's
      // tsconfig: strict + noEmit + erasableSyntaxOnly). The framework runs the
      // standard compiler, it does not embed one. Extra args after `typecheck`
      // pass through (e.g. `webjs typecheck --watch`). Exits non-zero on a type
      // error, so it works as a CI gate and the scaffolded `typecheck` script.
      const cwd = process.cwd();
      const { createRequire } = await import('node:module');
      let tscPath;
      try {
        const req = createRequire(join(cwd, 'package.json'));
        tscPath = req.resolve('typescript/bin/tsc');
      } catch {
        console.error(
          'webjs typecheck: TypeScript is not installed in this project.\n' +
          'Install it with `npm install -D typescript`, then re-run `webjs typecheck`.',
        );
        process.exit(1);
      }
      const child = spawn(process.execPath, [tscPath, '--noEmit', ...rest], {
        stdio: 'inherit',
        cwd,
      });
      child.on('exit', (code) => process.exit(code ?? 1));
      break;
    }
    case 'create': {
      const name = rest[0];
      if (!name || name.startsWith('-')) {
        console.error('Usage: webjs create <app-name> [--template full-stack|api]');
        // This branch fires for a MISSING name or one starting with `-`, so the
        // rule it prints has to lead with the first-character requirement. An
        // earlier wording listed the separators as allowed characters, which
        // reads as permission to the one user who just typed a leading hyphen.
        console.error('<app-name> must start with a letter or a digit, then letters, digits, "-", "." or "_".');
        process.exit(1);
      }
      const template = flag(rest, '--template', 'full-stack');
      if (!TEMPLATES.includes(template)) {
        // AI agents sometimes hallucinate template names ("blog", "todo",
        // "ecommerce"). Reject early with the canonical list + guidance
        // on which scaffold to pick for which kind of app.
        console.error(`Error: unknown template '${template}'.

Only two scaffolds exist:
  full-stack   (default): pages + components + API + Drizzle/SQLite, plus a
                browsable feature gallery. Auth is one of the gallery cards
                (login + session + a protected route), so a full-stack app
                already carries a real auth baseline. Pick this for any app
                the user describes in product terms (todo, blog, dashboard,
                marketplace, social feed, a SaaS with accounts, …).
  api          backend-only: route handlers + modules + Drizzle/SQLite, no
                pages/SSR. Pick this only if the user explicitly asks for an
                HTTP/JSON API with no UI.

The scaffold is a starting point. Replace the example layout/page/
components/schema with the actual app the user requested. Use Drizzle +
SQLite for persistence (already wired up). Never store app data in JSON
files.

Full docs: https://webjs.dev/docs`);
        process.exit(1);
      }
      // The name lands in the generated package.json `name` field AND is
      // interpolated into generated source (#1066), so a quote / backtick /
      // `${` in it emits a file that fails to parse on the first `webjs dev`.
      // Validate before anything is written, so a bad name leaves no directory
      // behind. `scaffoldApp` re-checks for programmatic callers.
      const nameCheck = checkAppName(name);
      if (!nameCheck.ok) {
        console.error(appNameErrorMessage(name, nameCheck.reason));
        process.exit(1);
      }
      const noInstall = rest.includes('--no-install');
      // --db picks the database dialect: sqlite (default) or postgres.
      const db = flag(rest, '--db', 'sqlite');
      // --runtime picks the target runtime: node (default) or bun. Orthogonal
      // to --template (#541). When omitted, scaffoldApp auto-detects bun from
      // the invoking PM (so `bun create webjs` implies bun).
      const runtime = flag(rest, '--runtime');
      if (runtime && !['node', 'bun'].includes(runtime)) {
        console.error(`Error: unknown --runtime '${runtime}'. Only node / bun are supported.`);
        process.exit(1);
      }
      const { scaffoldApp } = await import('../lib/create.js');
      await scaffoldApp(name, process.cwd(), { template, db, runtime, install: !noInstall });
      break;
    }
    case 'vendor': {
      const sub = rest[0];
      const args = rest.slice(1);
      const appDir = process.cwd();
      const { pinAll, unpinPackage, listPinned, auditPinned, findOutdated, updatePinned, readPinFile, ensureVendorCommittable, SUPPORTED_PROVIDERS } = await import('@webjsdev/server');

      // Parse `--from <provider>` once at the top so subcommands share it.
      // Mirrors importmap-rails's `bin/importmap pin foo --from jsdelivr`.
      let from = 'jspm';
      const fromIdx = args.indexOf('--from');
      if (fromIdx !== -1) {
        from = args[fromIdx + 1];
        if (!from || !SUPPORTED_PROVIDERS.has(from)) {
          console.error(
            `Unknown --from provider '${from || ''}'. Supported: ${[...SUPPORTED_PROVIDERS].join(', ')}.`,
          );
          process.exit(1);
        }
        // Strip --from + its argument so downstream flag checks like
        // `args.includes('--download')` aren't confused.
        args.splice(fromIdx, 2);
      }

      if (sub === 'pin') {
        const download = args.includes('--download');
        // Same precedence rule as `vendor update`: explicit --from
        // wins; otherwise pinAll reads the pin file's persisted
        // provider so a user who pinned via jsdelivr stays on it.
        // Pass undefined (not the parsed 'jspm' default) when no
        // --from to engage the pin-file fallback. Peek at the pin
        // file here to compute the log line before pinAll runs.
        const explicitFrom = fromIdx !== -1 ? from : undefined;
        const existing = await readPinFile(appDir);
        const usedFrom = explicitFrom || existing?.provider || 'jspm';
        console.log(
          `Pinning vendor packages from ${appDir}` +
          (usedFrom !== 'jspm' ? ` via ${usedFrom}` : '') +
          (download ? ' (downloading bundles)' : '') + '...',
        );
        const result = await pinAll(appDir, { download, from: explicitFrom });
        if (result.droppedUnresolvable && !result.pins?.length) {
          // The scan FOUND bare specifiers but every one was dropped because
          // it is not installed under node_modules, so no local version could
          // be read. Name them and point at the remedy instead of the
          // misleading "no bare imports found" message (#953).
          const list = result.droppedUnresolvable;
          // Root package name from a bare specifier: `@scope/pkg/sub` -> `@scope/pkg`,
          // `pkg/sub` -> `pkg`. This is the thing the user must `npm install`.
          const rootPkg = (s) => {
            const parts = s.split('/');
            return s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
          };
          console.error(
            `Pin: found ${list.length} bare-specifier import${list.length === 1 ? '' : 's'} in ` +
            `client code under ${appDir}, but could not resolve a version for ` +
            `${list.length === 1 ? 'it' : 'them'} (not installed under node_modules):`,
          );
          for (const s of list) console.error(`  ${s}`);
          console.error(
            `Install the package first (e.g. \`npm install ${rootPkg(list[0])}\`), then rerun ` +
            `\`webjs vendor pin\`. No pin file written.`,
          );
          process.exit(1);
        }
        if (result.noBareImports) {
          // Scanner found zero bare-specifier imports in client-
          // reachable source. Without this branch pinAll would write
          // `{ imports: {} }`, which readPinFile then rejects as empty,
          // leaving a useless file behind in whatever cwd.
          console.error(
            `Pin: no bare-specifier npm imports found in client code under ${appDir}. ` +
            `Nothing to pin (no pin file written). Add a bare import like ` +
            `\`import x from 'pkg-name'\` to a page or component, then rerun.`,
          );
          process.exit(1);
        }
        if (result.failed) {
          // pinAll refused to write the pin file because every install
          // failed to resolve via the chosen resolver (jspm.io's
          // Generator API powers all providers; the failure mode is
          // typically a brand-new published version not yet on the
          // CDN, a network outage, or a provider-side 5xx). Surface
          // the failure with the actual provider in the message so
          // the user can fix the cause before shipping.
          const provider = result.provider || 'jspm.io';
          console.error(
            `Pin FAILED: every package failed to resolve via ${provider}. No pin file written ` +
            `(would shadow the live-API fallback with an empty importmap and break the browser).`,
          );
          console.error(`Attempted installs:`);
          for (const i of result.attemptedInstalls) console.error(`  ${i}`);
          console.error(
            `Possible causes: the package version is too new for ${provider}'s CDN to have indexed yet; ` +
            `network outage; ${provider} is down. Try again in a few minutes, or pin an older version.`,
          );
          process.exit(1);
        }
        const { pins, pruned, downloaded } = result;
        for (const p of pins) {
          const sizeStr = p.bytes != null ? ` ${(p.bytes / 1024).toFixed(1)} KB` : '';
          console.log(`  ${(p.pkg + '@' + p.version).padEnd(40)}${sizeStr}`);
        }
        for (const f of pruned) {
          console.log(`  ${f.padEnd(40)} REMOVED (orphan)`);
        }
        const pinMsg = `Pinned ${pins.length} package${pins.length === 1 ? '' : 's'}, wrote .webjs/vendor/importmap.json` +
          (downloaded ? ` + ${downloaded} bundle${downloaded === 1 ? '' : 's'}` : '') + '.';
        const pruneMsg = pruned.length ? ` Pruned ${pruned.length} orphan${pruned.length === 1 ? '' : 's'}.` : '';
        console.log(pinMsg + pruneMsg);
        if (result.droppedUnresolvable?.length) {
          // A partial pin: some specifiers resolved, others were dropped for a
          // missing local version. Name the skipped ones so it is not silent.
          console.warn(
            `[webjs] Skipped ${result.droppedUnresolvable.length} import` +
            `${result.droppedUnresolvable.length === 1 ? '' : 's'} with no installed version ` +
            `(install then rerun to pin ${result.droppedUnresolvable.length === 1 ? 'it' : 'them'}):`,
          );
          for (const s of result.droppedUnresolvable) console.warn(`  ${s}`);
        }

        // Make the pins committable. Vendoring is opt-in, so the pins the
        // user just wrote are meant for source control; a `.gitignore`
        // that excludes `.webjs/` would silently swallow them. Fresh
        // scaffolds already carry the `!.webjs/vendor/` exception, so for
        // them this is a no-op. If the output IS ignored, self-heal the
        // app's own `.gitignore`; if there is no `.gitignore` to patch (the
        // ignore comes from a parent repo or `.git/info/exclude`), print a
        // notice so the pins do not vanish from `git status` unexplained.
        const committable = await ensureVendorCommittable(appDir);
        if (committable.patched) {
          console.log(
            `Added the \`.webjs/vendor/\` exception to .gitignore so these pins commit. ` +
            `Run \`git add .gitignore .webjs/vendor\`.`,
          );
        } else if (committable.ignored) {
          console.warn(
            `[webjs] .webjs/vendor/importmap.json is gitignored, so these pins will NOT ` +
            `commit. The ignore is not in this app's .gitignore (a parent repo's .gitignore ` +
            `or .git/info/exclude). Un-ignore it by adding \`!**/.webjs/vendor/\` and ` +
            `\`!**/.webjs/vendor/**\` where the \`.webjs\` exclusion lives, then ` +
            `\`git add .webjs/vendor\`. Verify with \`git check-ignore -q .webjs/vendor/importmap.json\`.`,
          );
        }
        break;
      }

      if (sub === 'unpin') {
        if (args.length === 0) {
          console.error('Usage: webjs vendor unpin <pkg>');
          process.exit(1);
        }
        let unpinFailed = false;
        for (const pkg of args) {
          const r = await unpinPackage(appDir, pkg);
          if (!r.removed) {
            console.error(`  ${pkg.padEnd(40)} not in pin file`);
            unpinFailed = true;
            continue;
          }
          const extra = r.deletedFile ? ` (also deleted ${r.deletedFile})` : '';
          console.log(`  ${pkg.padEnd(40)} unpinned${extra}`);
        }
        // Exit non-zero if ANY of the requested packages weren't in
        // the pin file. Scripts wrapping the CLI rely on the exit
        // code to detect "nothing was removed"; printing the message
        // alone wasn't enough.
        if (unpinFailed) process.exit(1);
        break;
      }

      if (sub === 'list') {
        const entries = await listPinned(appDir);
        if (entries.length === 0) {
          console.log('No pin file. Run "webjs vendor pin" to create .webjs/vendor/importmap.json.');
          break;
        }
        console.log(`Pinned packages from ${appDir}/.webjs/vendor/importmap.json:`);
        for (const e of entries) {
          const sizeStr = e.bytes != null ? ` ${(e.bytes / 1024).toFixed(1)} KB` : '';
          console.log(`  ${(e.pkg + '@' + e.version).padEnd(40)}${sizeStr}`);
          console.log(`    ${e.url}`);
        }
        console.log(`${entries.length} package${entries.length === 1 ? '' : 's'} pinned.`);
        break;
      }

      if (sub === 'audit') {
        // npm bulk-advisories check against pinned versions. Mirrors
        // bin/importmap audit. Exits non-zero when any vulnerability
        // is found so CI can gate on it.
        const { vulnerable, totalChecked, errored } = await auditPinned(appDir);
        if (totalChecked === 0) {
          console.log('No pinned packages to audit. Run "webjs vendor pin" first.');
          break;
        }
        if (errored) {
          console.error(
            `Could not reach registry.npmjs.org for security advisories ` +
            `(network failure, timeout, or 5xx). Retry when connectivity is back.`,
          );
          process.exit(1);
        }
        if (vulnerable.length === 0) {
          console.log(`No vulnerable packages found (${totalChecked} checked).`);
          break;
        }
        console.log(`Package                                  Severity   Vulnerable versions       Title`);
        for (const v of vulnerable) {
          console.log(
            `  ${v.name.padEnd(38)} ${v.severity.padEnd(10)} ${v.vulnerableVersions.padEnd(25)} ${v.title}`,
          );
        }
        const bySeverity = vulnerable.reduce((acc, v) => {
          acc[v.severity] = (acc[v.severity] || 0) + 1;
          return acc;
        }, /** @type {Record<string,number>} */ ({}));
        const summary = Object.entries(bySeverity)
          .sort((a, b) => b[1] - a[1])
          .map(([sev, n]) => `${n} ${sev}`).join(', ');
        console.error(
          `  ${vulnerable.length} vulnerabilit${vulnerable.length === 1 ? 'y' : 'ies'} found: ${summary}`,
        );
        process.exit(1);
      }

      if (sub === 'outdated') {
        // npm registry latest-version check against pinned versions.
        // Mirrors bin/importmap outdated. Exits non-zero when any
        // package is outdated so CI / Renovate-style automation can
        // detect it.
        const outdated = await findOutdated(appDir);
        if (outdated.length === 0) {
          console.log('No outdated packages found.');
          break;
        }
        console.log(`Package                                  Current               Latest`);
        for (const o of outdated) {
          console.log(`  ${o.pkg.padEnd(38)} ${o.current.padEnd(21)} ${o.latest}`);
        }
        console.error(
          `  ${outdated.length} outdated package${outdated.length === 1 ? '' : 's'} found.`,
        );
        process.exit(1);
      }

      if (sub === 'update') {
        // Re-pin outdated packages to latest. Mirrors bin/importmap
        // update. Does NOT modify package.json or node_modules; the
        // user should run `npm install <pkg>@<latest>` afterward to
        // keep the local install in sync.
        //
        // Provider precedence: explicit --from CLI flag wins. Without
        // it, updatePinned reads the pin file's persisted provider so
        // a user who pinned via jsdelivr stays on jsdelivr after
        // update. Pass `undefined` (not the parsed `from = 'jspm'`
        // default) when no --from was given so updatePinned's
        // pin-file fallback engages.
        const explicitFrom = fromIdx !== -1 ? from : undefined;
        const existing = await readPinFile(appDir);
        const usedFrom = explicitFrom || existing?.provider || 'jspm';
        console.log(`Updating outdated vendor pins in ${appDir}${usedFrom !== 'jspm' ? ` via ${usedFrom}` : ''}...`);
        const result = await updatePinned(appDir, { from: explicitFrom });
        if (result.noOutdated) {
          console.log('No outdated packages found.');
          break;
        }
        if (result.updated.length === 0) {
          console.error('No packages were updated (jspm.io may have failed to resolve any of the new versions).');
          process.exit(1);
        }
        for (const u of result.updated) {
          console.log(`  ${u.pkg.padEnd(38)} ${u.from} → ${u.to}`);
        }
        console.log(
          `Updated ${result.updated.length} package${result.updated.length === 1 ? '' : 's'}. ` +
          `Run \`npm install ${result.updated.map(u => `${u.pkg}@${u.to}`).join(' ')}\` to ` +
          `sync your node_modules.`,
        );
        break;
      }

      console.error(`Unknown vendor subcommand: ${sub || '(none)'}\n` +
        `Usage:\n` +
        `  webjs vendor pin [--from PROVIDER] [--download]   Pin packages to .webjs/vendor/importmap.json\n` +
        `  webjs vendor unpin <pkg>                          Remove a package from the pin file\n` +
        `  webjs vendor list                                 Show pinned packages with versions and URLs\n` +
        `  webjs vendor audit                                Run a security audit against pinned versions\n` +
        `  webjs vendor outdated                             Check pinned packages for newer versions\n` +
        `  webjs vendor update [--from PROVIDER]             Re-pin outdated packages to latest\n` +
        `\n` +
        `  --from PROVIDER     CDN to resolve through. One of: ${[...SUPPORTED_PROVIDERS].join(', ')}. Default: jspm.`);
      process.exit(1);
    }
    case 'mcp': {
      // Read-only MCP server (#262, #415) over stdio. STDOUT is the JSON-RPC
      // channel, so nothing here may write to stdout: the data functions are
      // read-only and `runMcpServer` routes all diagnostics to stderr. The
      // implementation lives in the standalone `@webjsdev/mcp` package (also
      // runnable directly as `npx @webjsdev/mcp`); `webjs mcp` delegates to it
      // for back-compat. The version advertised in the initialize handshake is
      // @webjsdev/mcp's own, resolved by its bin, so this passes none.
      const { runMcpServer } = await import('@webjsdev/mcp');
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      let version = '0.0.0';
      try {
        const { readFileSync } = await import('node:fs');
        version = JSON.parse(
          readFileSync(require.resolve('@webjsdev/mcp/package.json'), 'utf8'),
        ).version || version;
      } catch {}
      await runMcpServer({
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        cwd: process.cwd(),
        version,
      });
      break;
    }
    case 'version':
      // Print the installed CLI version (#975). Also reachable as the top-level
      // `webjs --version` / `-v` flag, handled at the top of main().
      console.log(readCliVersion());
      break;
    case 'help':
      // `webjs help <cmd>` prints that command's usage + Options + Examples
      // (#975); a bare `webjs help` prints the full banner. An unknown topic
      // exits non-zero (printCommandHelp returns false), matching the Remix CLI.
      if (rest[0]) {
        if (!printCommandHelp(rest[0])) process.exit(1);
      } else {
        console.log(USAGE);
      }
      break;
    case undefined:
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n` + USAGE);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
