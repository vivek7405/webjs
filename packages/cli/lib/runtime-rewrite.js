/**
 * Bun-first scaffold rewrites (#541).
 *
 * The scaffold authors every template in its node/npm form (ONE source of
 * truth, no drift) and DERIVES the bun-mode variant by transform when the app
 * is scaffolded with `--runtime bun` (or through `bun create webjs`). These are
 * pure string transforms so they unit-test without touching the filesystem.
 *
 * Why a transform and not a second set of template files: the agent-config
 * markdown (AGENTS.md / CONVENTIONS.md / .cursorrules / ...) plus the deploy
 * files (Dockerfile / ci.yml) are long and change often; a parallel bun copy
 * would silently drift from the node original. A transform keeps the node
 * template canonical and the bun output a deterministic function of it.
 *
 * The runtime axis is ORTHOGONAL to `--template` (the exactly-3-templates
 * invariant is untouched, this is a separate dimension).
 *
 * WHAT RUNS ON BUN, AND WHAT DOES NOT (the load-bearing design decision):
 * the SERVER (the `dev` / `start` scripts) runs on Bun, because that is the
 * app. The dev/build TOOLING (`webjs test` / `db:*` / `check` / `typecheck`)
 * stays on Node, because `webjs test` spawns `node --test` (Bun has no
 * `--test` flag; its runner is `bun test`). So:
 *   - the `dev` / `start` scripts force `bun --bun` (the server is Bun),
 *   - every other command stays `bun run` / `webjs ...` (runs on Node via the
 *     `webjs` bin's `#!/usr/bin/env node` shebang),
 *   - the Dockerfile is a pure `oven/bun:1` base (#595). This is safe as of
 *     `@webjsdev/cli@0.10.20` (#570): `webjs db migrate` resolves drizzle-kit
 *     and runs it under Bun (no `npx`), so a Node-less image works. (Before
 *     #570 shipped as `latest`, this stayed on `node:24-alpine` + a copied Bun
 *     binary, since the installed CLI could still shell `npx`.)
 */

/**
 * Rewrite command-shaped npm/npx invocations in prose (markdown / agent config /
 * the starter-test header comments) to their bun equivalents.
 *
 * `npm run dev` / `start` become `bun --bun run` (the `--bun` overrides the
 * `webjs` bin's Node shebang so the SERVER runs on Bun). Every OTHER script
 * becomes a plain `bun run` (Node tooling: forcing `--bun` on `webjs test`
 * would spawn the invalid `bun --test`). Bare "npm" as a word (e.g. "a
 * third-party npm package", "the npm registry") is left alone: packages still
 * come from npm, only the COMMAND changes.
 *
 * @param {string} s
 * @returns {string}
 */
export function bunifyProse(s) {
  return s
    // Prose claim about the Dockerfile CMD (AGENTS.md dev-start parity section);
    // the bun Dockerfile's CMD becomes `bun --bun run start`.
    .replaceAll('`CMD ["npm", "start"]`', '`CMD ["bun", "--bun", "run", "start"]`')
    // The "Containerized deploy" prose describes the node template's
    // node:24-alpine base; the bun Dockerfile is a pure oven/bun:1 image (#595),
    // so rewrite the base claim to match what the bun app actually ships. (The
    // trailing `npm start` is rewritten to `bun --bun run start` by the generic
    // rule below.)
    .replaceAll(
      'Dockerfile pins `node:24-alpine` (the same Node major CI uses), installs\ndeps (no build step, since Drizzle has no codegen), and starts via',
      'Dockerfile is a pure `oven/bun:1` image (no Node, since `webjs db migrate`\nresolves drizzle-kit and runs under Bun with no `npx`, #570), installs deps\nwith `bun install` (no build step, since Drizzle has no codegen), and starts via',
    )
    // The "Running on Bun" section frames Bun as opt-in ("force it with --bun").
    // In a bun-flavored app the dev/start scripts ALREADY embed --bun, so reframe
    // it as the configured default.
    .replaceAll('### Running on Bun instead of Node', '### Runtime: this app runs on Bun')
    .replaceAll(
      'The same `package.json` scripts work on\neither; to run under Bun, force it with `--bun` so the server executes on Bun\nrather than the `webjs` bin\'s Node shebang:',
      'This app is configured for Bun. Its `dev` / `start` scripts already force\n`--bun` (which overrides the `webjs` bin\'s Node shebang), so a plain `bun run dev`\nserves on Bun. The other scripts (test / db / check) run on Node, the runtime\nthe `webjs` tooling targets:',
    )
    // Invocation styles first, so "npm create webjs@latest" does not get
    // mangled by the generic "npm <x>" rules below.
    .replaceAll('npm create webjs@latest', 'bun create webjs')
    .replaceAll('npm create webjs', 'bun create webjs')
    // dev-dep installs (`npm install -D` and the `npm i -D` shorthand)
    .replace(/npm install -D /g, 'bun add -d ')
    .replace(/npm install --save-dev /g, 'bun add -d ')
    .replace(/npm i -D /g, 'bun add -d ')
    // a package install (followed by a package name) -> `bun add <pkg>`
    .replace(/npm install (?=[A-Za-z@])/g, 'bun add ')
    .replace(/npm i (?=[A-Za-z@])/g, 'bun add ')
    // bare install / ci -> `bun install`
    .replace(/npm install\b/g, 'bun install')
    .replace(/npm ci\b/g, 'bun install')
    // The SERVER scripts run on Bun (force --bun, overriding the Node shebang).
    .replace(/npm run dev\b/g, 'bun --bun run dev')
    .replace(/npm run start\b/g, 'bun --bun run start')
    .replace(/npm start\b/g, 'bun --bun run start')
    // Every other script is Node tooling (webjs test -> node --test, db -> npx
    // drizzle-kit): a plain `bun run` lets the shebang pick Node. NEVER --bun
    // here (it would make `webjs test` spawn the invalid `bun --test`).
    .replace(/npm run /g, 'bun run ')
    .replace(/npm test\b/g, 'bun run test')
    // one-off executors
    .replace(/npx /g, 'bunx ');
}

/**
 * Rewrite the scaffolded Dockerfile for Bun.
 *
 * Base decision (acceptance criterion): a pure `oven/bun:1` image (no Node).
 * Safe as of `@webjsdev/cli@0.10.20` (#570): `webjs db` / `webjs test` resolve
 * their tools (drizzle-kit, wtr) and spawn them with the current runtime instead
 * of `npx`, so the boot-time `webjs db migrate` runs under Bun with no Node
 * toolchain. (Before #570 was the published `latest`, this stayed on a
 * `node:24-alpine` base with a copied Bun binary, since the installed CLI could
 * still shell `npx`, which a pure Bun image lacks. #595 flipped it once the
 * npx-free CLI shipped.) `oven/bun:1` is Debian-based: `ca-certificates` ship in
 * the image, and SQLite uses the built-in bun:sqlite (no native module), so no
 * build toolchain is needed.
 *
 * @param {string} s
 * @returns {string}
 */
export function bunifyDockerfile(s) {
  return s
    // Top comment: explain the pure oven/bun base.
    .replace(
      /# webjs serves \.ts directly[\s\S]*?since the built-in stripper and recursive fs\.watch need it\.\n/,
      '# webjs serves .ts directly by stripping types at the runtime layer, so there is\n' +
      '# NO JavaScript build step (webjs is buildless end to end; there is no bundler or\n' +
      '# esbuild fallback). This image runs the app on **Bun**: the type-strip comes from\n' +
      '# `amaro`, the server serves via Bun.serve, and `webjs db migrate` runs under Bun\n' +
      '# (the CLI resolves drizzle-kit without npx, #570), so no Node is needed. webjs also\n' +
      '# runs on Node 24+; for a Node base instead, swap to `node:24-alpine` and start with\n' +
      '# `npm start`.\n',
    )
    .replace('FROM node:24-alpine', 'FROM oven/bun:1')
    // Debian base: ca-certificates already present, no `apk`. Drop the alpine line.
    .replace(
      /# ca-certificates for outbound TLS \(e\.g\. a managed Postgres\)\. SQLite uses the\n# built-in node:sqlite \(no native module, no build toolchain needed\)\.\nRUN apk add --no-cache ca-certificates\n\n/,
      '# The Debian-based oven/bun image ships ca-certificates for outbound TLS (e.g. a\n# managed Postgres). SQLite uses the built-in bun:sqlite (no native module), so no\n# build toolchain is needed.\n\n',
    )
    // Lockfile + install (bun.lock, bun install).
    .replace(
      '# package-lock.json is optional (it\'s absent when the app was scaffolded with\n# --no-install); the glob keeps the COPY working with or without it.\nCOPY package.json package-lock.json* ./\nRUN npm install --no-audit --no-fund',
      '# bun.lock is optional (absent when scaffolded with --no-install); the glob keeps\n# the COPY working with or without it. SQLite uses the built-in bun:sqlite, so no\n# native dependency or postinstall is involved.\nCOPY package.json bun.lock* ./\nRUN bun install',
    )
    // Healthcheck: the pure Bun image has no node; use `bun -e`. Keep the
    // dependency-free-probe comment accurate (the probe runs under Bun now).
    .replace("(Node 24's built-in fetch, no curl/wget)", "(the runtime's built-in fetch, no curl/wget)")
    .replace('CMD ["node", "-e", "fetch(', 'CMD ["bun", "-e", "fetch(')
    // Entrypoint: serve on Bun.
    .replace(
      /# `npm start` is a thin alias[\s\S]*?the migrate no longer depends on an npm `prestart` hook\.\nCMD \["npm", "start"\]/,
      '# `bun --bun run start` runs the `start` script on Bun (the server serves via\n' +
      '# Bun.serve). `webjs start` runs the `webjs.start.before` steps: `webjs db migrate`\n' +
      '# (resolves drizzle-kit and runs it under Bun, no npx, #570) and, for a UI app,\n' +
      '# the Tailwind compile under `bun --bun` (no Node / npm in the image, #947), both\n' +
      '# idempotent, then serves on $PORT.\n' +
      'CMD ["bun", "--bun", "run", "start"]',
    );
}

/**
 * Rewrite compose.yaml for the pure-Bun image (#595): its healthcheck runs in
 * the `oven/bun:1` container (compose's healthcheck overrides the Dockerfile's),
 * which has no `node`, so switch `node -e` to `bun -e`. compose otherwise builds
 * from the Dockerfile and inherits its `bun --bun run start` CMD, so nothing
 * else changes.
 *
 * @param {string} s
 * @returns {string}
 */
export function bunifyCompose(s) {
  return s.replace('test: ["CMD", "node", "-e", "fetch(', 'test: ["CMD", "bun", "-e", "fetch(');
}

/**
 * Rewrite the GitHub Actions CI workflow for Bun: ADD `oven-sh/setup-bun`
 * alongside `actions/setup-node` (kept, because the `webjs` test/db/check
 * tooling runs on Node), install with `bun install` (uses bun.lock), and run
 * scripts with a plain `bun run` (the script bodies' `webjs ...` resolve to Node
 * via the shebang, and dev/start are not run in CI). The `node -e` Chromium-path
 * step stays (Node is present from setup-node).
 *
 * @param {string} s
 * @returns {string}
 */
export function bunifyCi(s) {
  return s
    // Keep the Node setup (the tooling needs it), add Bun for `bun install`.
    // Drop `cache: npm` (the cache is bun's now; setup-bun caches by default).
    .replaceAll(
      "- uses: actions/setup-node@v6\n        with:\n          node-version: '24'\n          cache: npm",
      "- uses: actions/setup-node@v6\n        with:\n          node-version: '24'\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: latest",
    )
    .replaceAll('- run: npm ci', '- run: bun install')
    .replaceAll('npm install --no-save ', 'bun add --no-save ')
    .replaceAll('npm run ', 'bun run ')
    .replaceAll('npx ', 'bunx ');
}
