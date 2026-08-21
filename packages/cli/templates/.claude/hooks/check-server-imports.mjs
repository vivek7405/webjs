// Node walker for check-server-imports.sh (#804). Reads the PreToolUse JSON
// payload (arg or stdin), extracts the file being edited and its proposed
// content, and warns when a browser-facing app module adds an import of a
// server-only `.server.*` utility (no `'use server'`). WARN by default; a
// clean edit prints nothing and exits 0.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

function readPayload() {
  const arg = process.argv[2];
  if (arg && arg.trim().startsWith('{')) return arg;
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

let data;
try { data = JSON.parse(readPayload() || '{}'); } catch { process.exit(0); }
const input = data.tool_input || {};
const filePath = input.file_path || input.filePath || '';
if (!filePath) process.exit(0);

// Only browser-facing app modules matter. A `.server.*` file (the boundary) or a
// route.ts / middleware.ts (never shipped) is allowed to import server code.
const rel = filePath.replace(/\\/g, '/');
const isAppModule = /\/(app|components|modules|lib)\/.*\.(ts|js|mts|mjs)$/.test('/' + rel) || /(^|\/)(app|components|modules|lib)\//.test(rel);
if (!isAppModule) process.exit(0);
if (/\.server\.(ts|js|mts|mjs)$/.test(rel)) process.exit(0);
if (/(^|\/)(route|middleware)\.(ts|js|mts|mjs)$/.test(rel)) process.exit(0);

// Proposed content: Write has `content`; Edit has `new_string`; else read disk.
let content = input.content ?? input.new_string ?? '';
if (!content && existsSync(filePath)) { try { content = readFileSync(filePath, 'utf8'); } catch { /* ignore */ } }
if (!content) process.exit(0);

// Find the app root (walks up for a package.json with a `#*` imports map or a db/ dir).
function findAppRoot(start) {
  let dir = dirname(resolve(start));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && (existsSync(join(dir, 'app')) || existsSync(join(dir, 'db')))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dirname(resolve(start));
}
const appRoot = findAppRoot(filePath);

// Collect import specifiers, skipping `import type` (erased by the stripper).
const specs = [];
const re = /(?:^|\n)\s*import\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g;
let m;
while ((m = re.exec(content))) { if (!m[1]) specs.push(m[2]); }

function resolveSpec(spec) {
  if (spec.startsWith('#')) return join(appRoot, spec.slice(1).replace(/^\//, ''));
  if (spec.startsWith('.')) return resolve(dirname(filePath), spec);
  return null; // bare npm specifier
}

const offenders = [];
for (const spec of specs) {
  if (!/\.server\.(ts|js|mts|mjs)$/.test(spec)) continue;
  const abs = resolveSpec(spec);
  if (!abs || !existsSync(abs)) continue;
  let src = '';
  try { src = readFileSync(abs, 'utf8'); } catch { continue; }
  const head = src.split('\n').slice(0, 5).join('\n');
  const hasUseServer = /^\s*(['"])use server\1\s*;?\s*$/m.test(head);
  if (!hasUseServer) offenders.push(spec);
}

if (offenders.length === 0) process.exit(0);

const msg =
  `A browser-facing module (${rel}) imports a server-only utility: ${offenders.join(', ')}. ` +
  `A .server.{ts,js} file with NO 'use server' directive throws at load in the browser, ` +
  `so this would crash the page (webjs check flags it as no-server-import-in-browser-module). ` +
  `Fix: add 'use server' to make it an RPC action, or reach it from a 'use server' action / route.ts / ` +
  `middleware.ts, or share only a type via 'import type'. See the skill's references/data-and-actions.md.`;

if (process.env.WEBJS_SERVER_IMPORT_GATE === 'block') {
  process.stderr.write(`BLOCKED: ${msg}\n`);
  process.exit(2);
}
// WARN: surface as additionalContext, allow the edit.
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } }) + '\n');
process.exit(0);
