import { statSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Read the CLI package's own `engines.node` so the required Node major lives in
 * one place (mirrors how `bin/webjs.js` sources it). Falls back to `>=24.0.0`.
 * @param {string} cliDir  directory of THIS file's package (lib/ -> package root)
 * @returns {Promise<string>}
 */
export async function readEngines(cliDir) {
  try {
    const pkg = JSON.parse(await readFile(join(cliDir, '..', 'package.json'), 'utf8'));
    return pkg?.engines?.node || '>=24.0.0';
  } catch {
    return '>=24.0.0';
  }
}

/**
 * Strip `//` line comments, block comments, and trailing commas from a JSONC
 * string so a tsconfig (which permits all three) parses with `JSON.parse`.
 * Deliberately simple: it does not honor comment-looking sequences inside
 * string values, which is acceptable for a tsconfig (paths rarely contain `//`
 * or block-comment markers, and the worst case is a parse failure the caller
 * already degrades to a WARN).
 * @param {string} text
 * @returns {string}
 */
export function stripJsonc(text) {
  let out = '';
  let inString = false;
  let stringQuote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Copy the escaped char verbatim so an escaped quote does not end the string.
        out += text[i + 1] || '';
        i++;
      } else if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // land on the '/'
      continue;
    }
    out += ch;
  }
  // Drop trailing commas before } or ].
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Parse a `.env`-style file into the SET of KEY names it declares. A simple
 * `KEY=value` line parse: comments (`#`) and blank lines are skipped, and only
 * the key before the first `=` is taken (the value is irrelevant for drift).
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseEnvKeys(text) {
  const keys = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    // Tolerate a leading `export ` (a common .env.example convention).
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
  }
  return keys;
}

// Directories never worth walking for the CSS-freshness advisory (mirrors
// dev-regenerate's IGNORE_DIRS): build output, deps, VCS + framework caches.
const FRESHNESS_IGNORE = new Set(['node_modules', '.git', '.webjs', 'dist', '.next', 'coverage']);

/**
 * Newest mtime (ms) of any FILE under a path (a file's own, or the max over the
 * files in a directory tree, skipping dependencies / dotfiles). Directory-node
 * mtimes are NOT counted, matching dev-regenerate's walker: a content edit only
 * shows through the file mtime, and a directory mtime is a flaky moving target.
 * A missing path is 0. Best-effort: never throws.
 * @param {string} abs
 * @returns {number}
 */
export function newestMtimeMs(abs) {
  let st;
  try { st = statSync(abs); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  let entries;
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return newest; }
  for (const e of entries) {
    if (e.name.startsWith('.') || FRESHNESS_IGNORE.has(e.name)) continue;
    // Skip symlinks: following one can cycle into unbounded recursion (a stack
    // overflow here) or escape into node_modules. Same tradeoff as the server
    // walker in dev-regenerate.js.
    if (e.isSymbolicLink()) continue;
    const m = newestMtimeMs(join(abs, e.name));
    if (m > newest) newest = m;
  }
  return newest;
}

/**
 * Whether the `<link>` tag at `idx` is commented out, so dead markup is never
 * reported as a live finding.
 *
 * A DELIMITED comment is decided by an unclosed opener behind the tag. Neither
 * `<!--` nor `/*` nests, so "nearest opener beats nearest closer" is exact, and
 * it covers a multi-line block whose interior lines carry no marker of their
 * own (what an editor's toggle-block-comment writes). A `//` has no closer, so
 * it is decided from the tag's own line: a `//` inside an href later in the
 * line cannot match, because the line does not START with it.
 *
 * Do NOT replace this with a lexer. Two attempts did, and both shipped bugs a
 * stateless test cannot have: a line-blanking regex killed any line holding a
 * protocol-relative url, and a quote-tracking walk inverted string/code
 * polarity on a nested ``html`...` `` inside a `${}` hole (one quote char
 * cannot model nesting), so an unbalanced apostrophe in template text
 * desynchronized the rest of the file. This check does not need to lex
 * JavaScript. If it ever genuinely does, export `redactStringsAndTemplates`
 * from `@webjsdev/server` (`src/js-scan.js`, fuzz-tested differentially against
 * a real TypeScript parse) rather than growing a third one here.
 *
 * Residual gap: a tag behind a `//` that trails real code on the same line
 * stays reported. Rare, and it fails toward reporting rather than toward the
 * silent inertness both lexers produced.
 *
 * @param {string} src
 * @param {number} idx  index of the tag's `<`
 * @returns {boolean}
 */
export function isCommentedOut(src, idx) {
  const before = src.slice(0, idx);
  if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return true;
  if (before.lastIndexOf('/*') > before.lastIndexOf('*/')) return true;
  const lineStart = before.lastIndexOf('\n') + 1;
  return before.slice(lineStart).trimStart().startsWith('//');
}
