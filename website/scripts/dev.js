#!/usr/bin/env node
/**
 * Starts the website + example blog together.
 * One command, two servers:
 *   - Website (landing + docs)  → http://localhost:5000
 *   - Example blog              → http://localhost:3456
 *
 * Both are webjs apps running in dev mode with file watching.
 * Ctrl-C stops both.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

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

// Start website (this directory)
start('website', resolve(__dirname, '..'), ['webjs', 'dev', '--port', '5000']);

// Start docs
start('docs', resolve(root, 'docs'), ['webjs', 'dev', '--port', '4000']);

// Start example blog
start('blog', resolve(root, 'examples', 'blog'), ['webjs', 'dev', '--port', '3456']);

// Cleanup on Ctrl-C
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
