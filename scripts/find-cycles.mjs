import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const roots = process.argv.slice(2).map((d) => resolve(d));
const files = [];

function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') walk(p);
    } else if (/\.m?js$/.test(e.name)) {
      files.push(p);
    }
  }
}

for (const r of roots) walk(r);

const RE = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
const graph = new Map();

for (const f of files) {
  const content = readFileSync(f, 'utf8');
  const deps = [];
  for (const m of content.matchAll(RE)) {
    const rel = m[1] || m[2];
    let resolved = resolve(dirname(f), rel);
    if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs')) resolved += '.js';
    deps.push(resolved);
  }
  graph.set(f, deps);
}

function findCycles() {
  const cycles = [];
  const visited = new Set();
  const stack = [];

  function dfs(node) {
    if (stack.includes(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node);
      cycles.push(cycle);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (graph.has(dep)) dfs(dep);
    }
    stack.pop();
  }

  for (const file of graph.keys()) {
    dfs(file);
  }
  return cycles;
}

const cycles = findCycles();
if (cycles.length > 0) {
  console.error('Found cycles:', cycles);
  process.exit(1);
} else {
  console.log('No cycles found.');
}
