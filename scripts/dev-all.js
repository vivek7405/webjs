#!/usr/bin/env node
/**
 * Starts the website, docs, and example blog together.
 * One command, three servers:
 *   - Website (landing)  → http://localhost:5000
 *   - Docs               → http://localhost:4000
 *   - Example blog       → http://localhost:3456
 *
 * All three are webjs apps running in dev mode with file watching.
 * Ctrl-C stops all.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const procs = [];

function start(name, cwd, args) {
  console.log(`▲ starting ${name}...`);
  const child = spawn('npx', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
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

start('website', resolve(root, 'website'), ['webjs', 'dev', '--port', '5000']);
start('docs', resolve(root, 'docs'), ['webjs', 'dev', '--port', '4000']);
start('blog', resolve(root, 'examples', 'blog'), ['webjs', 'dev', '--port', '3456']);

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
  Website   → http://localhost:5000
  Docs      → http://localhost:4000
  Blog Demo → http://localhost:3456

  Ctrl-C to stop all.
`);
