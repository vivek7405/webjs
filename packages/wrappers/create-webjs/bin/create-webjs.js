#!/usr/bin/env node
/**
 * `create-webjs` is the `npx` / `npm create` entry point for scaffolding a
 * webjs app.
 *
 *   npm create webjs@latest my-app
 *   npx create-webjs@latest my-app
 *   npm create webjs@latest my-api  -- --template api
 *   npm create webjs@latest my-api  -- --template api --no-install
 *
 * This is a thin wrapper around `@webjsdev/cli`'s `scaffoldApp()`. Behaviour
 * matches `webjs create` exactly, including auto-install (npm / pnpm / yarn /
 * bun, detected from `npm_config_user_agent`). Pass `--no-install` to opt out.
 *
 * The package mirrors the create-next-app / create-react-app / create-astro
 * pattern so the homepage hero is a single command and users don't need a
 * global install of `@webjsdev/cli` to start. The `npm create <suffix>` form
 * is npm's documented shorthand for `npx create-<suffix>`; both routes
 * resolve to this same package and bin.
 */
import { scaffoldApp } from '@webjsdev/cli/lib/create.js';
import { checkAppName, appNameErrorMessage } from '@webjsdev/cli/lib/app-name.js';

const TEMPLATES = ['full-stack', 'api'];

const args = process.argv.slice(2);

function flagValue(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

const usage = `Usage:
  npm create webjs@latest <app-name> [-- --template full-stack|api] [-- --no-install]
  npx create-webjs@latest <app-name> [--template full-stack|api] [--no-install]

The <app-name> must be a valid package name: letters, digits, and
the separators "-", "." and "_", starting with a letter or a digit, at most 214
characters. It becomes the directory, the package.json name, AND a value written
into generated source, so anything else is rejected before any file is written.

Templates:
  full-stack (default)  pages + components + API + Drizzle/SQLite + gallery
                        (auth ships as a gallery card: login + session + a protected route)
  api                   route handlers + modules + Drizzle, no SSR/UI

Options:
  --db sqlite|postgres  database dialect (default sqlite)
  --runtime node|bun    target runtime (default node). bun emits a Bun-flavored app
                        (bun.lock, bun Dockerfile/CI, bun docs). Auto-detected as bun
                        when invoked via \`bun create webjs\`.
  --no-install          skip running the package manager's install in the new directory
  -h, --help            show this help`;

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(usage);
  process.exit(args.length === 0 ? 1 : 0);
}

// Positional args are the non-flag tokens, but a value-taking flag's VALUE
// (e.g. the `bun` in `--runtime bun`) is not positional. Skip it so
// `create-webjs --runtime bun my-app` reads `my-app` as the name, not `bun`.
const VALUE_FLAGS = new Set(['--template', '--runtime', '--db']);
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('-')) { if (VALUE_FLAGS.has(a)) i++; continue; }
  positional.push(a);
}
const name = positional[0];
if (!name) {
  console.error('Error: <app-name> is required.\n');
  console.error(usage);
  process.exit(1);
}

// Same guard as `webjs create` (#1066): the name is written into the generated
// package.json and interpolated into generated source, so it has to be a valid
// npm package name before any file is written. `scaffoldApp` re-checks, but
// catching it here prints the guidance instead of an unhandled rejection.
const nameCheck = checkAppName(name);
if (!nameCheck.ok) {
  console.error(appNameErrorMessage(name, nameCheck.reason));
  process.exit(1);
}

const template = flagValue('--template') || 'full-stack';
if (!TEMPLATES.includes(template)) {
  console.error(`Error: unknown template '${template}'. Only ${TEMPLATES.join(' / ')} are supported.\n`);
  console.error(usage);
  process.exit(1);
}

// --runtime node|bun (#541), orthogonal to --template. Omitted -> scaffoldApp
// auto-detects bun from the invoking PM, so `bun create webjs my-app` implies
// bun mode with no flag.
const runtime = flagValue('--runtime');
if (runtime && !['node', 'bun'].includes(runtime)) {
  console.error(`Error: unknown runtime '${runtime}'. Only node / bun are supported.\n`);
  console.error(usage);
  process.exit(1);
}

// --db sqlite|postgres, forwarded so the wrapper matches `webjs create` (the
// bin parses --db; the wrapper previously dropped it, silently scaffolding
// sqlite for `npm create webjs my-app -- --db postgres`). scaffoldApp validates.
const db = flagValue('--db');

const noInstall = args.includes('--no-install');

await scaffoldApp(name, process.cwd(), { template, db, runtime, install: !noInstall });
