#!/usr/bin/env node
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

const USAGE = `webjs — commands:
  webjs dev   [--port 3000]                       Start dev server with live reload
  webjs build                                     Bundle components + pages for production
  webjs start [--port 3000]                       Start production server
              [--http2 --cert <path> --key <path>]  Serve HTTP/2 over TLS (falls back to h1.1)
  webjs test  [--e2e]                             Run unit tests (+ E2E with --e2e)
  webjs check                                     Validate app against conventions
  webjs create <name>                             Scaffold a new webjs app
  webjs db generate                               Run \`prisma generate\`
  webjs db migrate [name]                         Run \`prisma migrate dev\`
  webjs db studio                                 Run \`prisma studio\`
  webjs help                                      Show this help`;

/** @param {string[]} args */
function flag(args, name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1];
}

async function main() {
  switch (cmd) {
    case 'dev': {
      // If we're already inside the --watch child, start the server directly.
      if (process.env.__WEBJS_DEV_CHILD === '1') {
        const { startServer } = await import('@webjs/server');
        const port = Number(flag(rest, '--port', process.env.PORT || 3000));
        await startServer({ appDir: process.cwd(), port, dev: true });
        break;
      }

      // Otherwise, spawn ourselves as a child with node --watch.
      // This restarts the process on file changes, guaranteeing a fresh
      // Node ESM module cache. Without this, edits to transitively-imported
      // modules (actions, queries, components, utils) don't take effect
      // because Node caches ESM by URL with no public invalidation API.
      // Build watch paths from directories that exist in the project.
      const { existsSync } = await import('node:fs');
      const watchPaths = [];
      for (const dir of ['app', 'components', 'modules', 'lib', 'actions']) {
        if (existsSync(dir)) watchPaths.push('--watch-path', dir);
      }
      // Watch root middleware/config if present
      for (const f of ['middleware.ts', 'middleware.js']) {
        if (existsSync(f)) watchPaths.push('--watch-path', f);
      }

      const child = spawn(
        process.execPath,
        [
          '--watch',
          '--watch-preserve-output',
          ...watchPaths,
          ...process.argv.slice(1),
        ],
        {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: { ...process.env, __WEBJS_DEV_CHILD: '1' },
        },
      );
      child.on('exit', (code) => process.exit(code ?? 0));
      break;
    }
    case 'start': {
      const { startServer } = await import('@webjs/server');
      const port = Number(flag(rest, '--port', process.env.PORT || 3000));
      const http2 = rest.includes('--http2');
      const cert = flag(rest, '--cert');
      const key = flag(rest, '--key');
      await startServer({ appDir: process.cwd(), port, dev: false, http2, cert, key });
      break;
    }
    case 'build': {
      const { buildBundle } = await import('@webjs/server');
      const t = Date.now();
      const result = await buildBundle({
        appDir: process.cwd(),
        minify: rest.includes('--no-minify') ? false : true,
        sourcemap: rest.includes('--no-sourcemap') ? false : true,
      });
      if (result.bundleFile) {
        console.log(`webjs: bundled ${result.entries.length} entries → ${result.bundleFile} (${Date.now() - t}ms)`);
      }
      break;
    }
    case 'db': {
      const sub = rest[0];
      const args = rest.slice(1);
      const map = { generate: ['generate'], migrate: ['migrate', 'dev', ...args], studio: ['studio'] };
      const prismaArgs = map[sub];
      if (!prismaArgs) { console.error('Unknown db subcommand.\n' + USAGE); process.exit(1); }
      const child = spawn('npx', ['prisma', ...prismaArgs], { stdio: 'inherit', cwd: process.cwd() });
      child.on('exit', (code) => process.exit(code ?? 0));
      break;
    }
    case 'test': {
      const e2e = rest.includes('--e2e');
      const cwd = process.cwd();

      // Discover test files
      const { existsSync } = await import('node:fs');
      const { readdir } = await import('node:fs/promises');

      const testFiles = [];

      // Unit tests: test/unit/*.test.{js,ts}
      const unitDir = join(cwd, 'test', 'unit');
      if (existsSync(unitDir)) {
        const files = await readdir(unitDir);
        for (const f of files) {
          if (/\.test\.(js|ts|mjs|mts)$/.test(f)) testFiles.push(join(unitDir, f));
        }
      }

      // Also check root test/*.test.{js,ts} (flat layout)
      const testDir = join(cwd, 'test');
      if (existsSync(testDir)) {
        const files = await readdir(testDir);
        for (const f of files) {
          if (/\.test\.(js|ts|mjs|mts)$/.test(f) && !f.startsWith('e2e')) {
            const full = join(testDir, f);
            if (!testFiles.includes(full)) testFiles.push(full);
          }
        }
      }

      // E2E tests: test/e2e/*.test.{js,ts}
      if (e2e) {
        const e2eDir = join(cwd, 'test', 'e2e');
        if (existsSync(e2eDir)) {
          const files = await readdir(e2eDir);
          for (const f of files) {
            if (/\.test\.(js|ts|mjs|mts)$/.test(f)) testFiles.push(join(e2eDir, f));
          }
        }
      }

      if (testFiles.length === 0) {
        console.log('webjs test: no test files found.');
        console.log('  Expected: test/unit/*.test.ts or test/e2e/*.test.ts');
        console.log('  Run: webjs create <name> to scaffold a project with example tests.');
        break;
      }

      const env = { ...process.env };
      if (e2e) env.WEBJS_E2E = '1';

      console.log(`webjs test: running ${testFiles.length} test file(s)${e2e ? ' (including E2E)' : ''}…\n`);
      const child = spawn(process.execPath, ['--test', ...testFiles], {
        stdio: 'inherit',
        cwd,
        env,
      });
      child.on('exit', (code) => process.exit(code ?? 0));
      break;
    }
    case 'check': {
      const { checkConventions, RULES } = await import('@webjs/server/check');
      const violations = await checkConventions(process.cwd());

      if (rest.includes('--rules')) {
        console.log('webjs check — available rules:\n');
        for (const r of RULES) {
          console.log(`  ${r.name.padEnd(30)} ${r.description}`);
        }
        break;
      }

      if (violations.length === 0) {
        console.log('webjs check: all conventions pass ✓');
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
    case 'create': {
      const name = rest[0];
      if (!name) {
        console.error('Usage: webjs create <app-name>');
        process.exit(1);
      }
      const { scaffoldApp } = await import('../lib/create.js');
      await scaffoldApp(name, process.cwd());
      break;
    }
    case 'help':
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
