#!/usr/bin/env node
/**
 * Starts the website, docs, example blog, and UI registry site together.
 * One command, four servers (defaults):
 *   - Website (landing)  → http://localhost:5001
 *   - Docs               → http://localhost:5002
 *   - UI registry site   → http://localhost:5003
 *   - Example blog       → http://localhost:5004
 *
 * Ports sit in the 5001-5004 block on purpose: macOS reserves 5000 for
 * the AirPlay Receiver / Control Center, so a dev server there silently
 * fails to bind on Macs.
 *
 * Override any port via its env var:
 *   WEBSITE_PORT=8080 DOCS_PORT=8081 npm run dev
 *
 * All four are webjs apps running in dev mode with file watching.
 * Ctrl-C stops all.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const procs = [];

function start(name, cwd, cmd, args, extraEnv = {}) {
  console.log(`▲ starting ${name}...`);
  const child = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
  child.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.log(`[${name}] ${line}`);
    }
  });
  child.stderr.on('data', (d) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.error(`[${name}] ${line}`);
    }
  });
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
  });
  procs.push(child);
  return child;
}

// Per-service ports, each overridable via its own env var. Each app's
// `webjs:dev` script reads PORT (with a matching default baked in), so
// setting PORT here is what actually drives the bind.
const ports = {
  website: process.env.WEBSITE_PORT || '5001',
  docs:    process.env.DOCS_PORT    || '5002',
  ui:      process.env.UI_PORT      || '5003',
  blog:    process.env.BLOG_PORT    || '5004',
};

// Use each workspace's `npm run dev` so the concurrently-spawned
// tailwind CLI watcher (and, for the blog, the db migrate; for the website,
// the registry-mirror step the /ui previews need) runs too.
// Point every app's nav + footer cross-links at the sibling dev servers. Each
// app's lib/links.ts reads these and otherwise falls back to the production
// domains, which is why a local cross-link would otherwise open the live site.
// Derived from the resolved ports so a WEBSITE_PORT / DOCS_PORT / UI_PORT /
// BLOG_PORT override flows through to every app, not just the website.
const links = {
  WEBSITE_URL: `http://localhost:${ports.website}`,
  EXAMPLE_BLOG_URL: `http://localhost:${ports.blog}`,
};
// The docs (webjs.dev/docs) and the component gallery (webjs.dev/ui) are both
// served BY the website now, so there is no DOCS_URL or UI_URL cross-link.
// Both old subdomains are redirect-only hosts, and SITE_URL is where each
// sends everything, which locally has to be the website dev server rather than
// production. Without it, hitting either one in local dev silently lands you
// on the live site.
const siteUrl = { SITE_URL: `http://localhost:${ports.website}` };
start('website', resolve(root, 'website'), 'npm', ['run', 'dev'], { PORT: ports.website, ...links });
start('docs',    resolve(root, 'docs'),    'npm', ['run', 'dev'], { PORT: ports.docs, ...links, ...siteUrl });
start('ui',      resolve(root, 'packages', 'ui', 'packages', 'website'), 'npm', ['run', 'dev'], { PORT: ports.ui, ...links, ...siteUrl });
start('blog',    resolve(root, 'examples', 'blog'), 'npm', ['run', 'dev'], { PORT: ports.blog, ...links });

function cleanup() {
  console.log('\n▲ shutting down...');
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

console.log(`
▲ webjs development servers:
  Website     → http://localhost:${ports.website}
  Docs        → http://localhost:${ports.website}/docs
  docs.webjs.dev redirect host → http://localhost:${ports.docs}
  UI registry → http://localhost:${ports.ui}
  Demo        → http://localhost:${ports.blog}

  Override any port: WEBSITE_PORT / DOCS_PORT / UI_PORT / BLOG_PORT
  Ctrl-C to stop all.
`);
