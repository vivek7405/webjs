/**
 * Dev error overlay frames (#264).
 *
 * The dev server pushes a structured error frame over the existing SSE reload
 * channel so the open tab renders a rich overlay (message, parsed location, a
 * source code frame) without a manual reload, the way Vite's HMR error overlay
 * and Next's dev overlay work. This module is the PURE frame builder: it parses
 * an error's stack for the offending file location and reads a source excerpt.
 * It is DEV-ONLY by construction (the caller gates on `dev`), so no file path or
 * source ever reaches a production response.
 *
 * `buildDevErrorFrame` returns a plain JSON-serializable object the reload
 * client renders. The only side effect is a guarded `readFileSync` of the
 * offending source file for the code frame (a read failure degrades to no
 * frame, never throws).
 */
import { readFileSync } from 'node:fs';

/**
 * Pull the first useful `file:line:column` out of an error stack. Prefers a
 * frame under `appDir` (the user's own code) over a framework / node_modules
 * frame, so the overlay points at the edit that broke, not WebJs internals.
 *
 * Handles the V8 stack forms `at fn (/abs/file.ts:12:5)`, `at /abs/file.ts:12:5`,
 * and `at file:///abs/file.ts:12:5`.
 *
 * @param {string} stack
 * @param {string} [appDir]
 * @returns {{ file: string, line: number, column: number } | null}
 */
export function parseStackLocation(stack, appDir) {
  if (typeof stack !== 'string') return null;
  // Capture `/abs/path` (group 1) then an OPTIONAL `?query` (the dev module
  // loader appends a `?t=<mtime>` cache-bust, which would otherwise be glued to
  // the path and break the readFileSync that builds the code frame), then
  // `:line:col`. The path class excludes `?` so the query is split off.
  //
  // POSIX-first: this anchors on a leading `/`, so a Windows `C:\...` bare-path
  // frame yields no location and the overlay degrades to a message-only card
  // (the `file:///` URL form, whose path uses forward slashes, still resolves).
  // That matches the framework's POSIX-first dev posture; it degrades, never
  // crashes.
  const re = /(?:file:\/\/)?(\/[^\s:()?]+)(?:\?[^\s:()]*)?:(\d+):(\d+)/g;
  /** @type {{ file: string, line: number, column: number }[]} */
  const frames = [];
  let m;
  while ((m = re.exec(stack)) !== null) {
    frames.push({ file: m[1], line: Number(m[2]), column: Number(m[3]) });
  }
  if (!frames.length) return null;
  // Prefer a frame in the app (not node_modules), then the first app frame,
  // else the first frame overall.
  const inApp = frames.filter(
    (f) => (!appDir || f.file.startsWith(appDir)) && !f.file.includes('/node_modules/')
  );
  return (inApp[0] || frames.find((f) => !f.file.includes('/node_modules/')) || frames[0]);
}

/**
 * Read a source excerpt around `line` (1-based), `context` lines on each side,
 * formatted with line numbers and a `>` marker on the offending line plus a
 * caret under `column`. Returns null when the file cannot be read.
 *
 * @param {string} file
 * @param {number} line
 * @param {number} [column]
 * @param {number} [context]
 * @returns {string | null}
 */
export function readCodeFrame(file, line, column, context = 3) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return null; }
  const lines = src.split('\n');
  if (line < 1 || line > lines.length) return null;
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const gutter = String(end).length;
  /** @type {string[]} */
  const out = [];
  for (let n = start; n <= end; n++) {
    const marker = n === line ? '>' : ' ';
    out.push(`${marker} ${String(n).padStart(gutter)} | ${lines[n - 1]}`);
    if (n === line && column && column > 0) {
      // A caret line under the offending column (account for the gutter prefix).
      out.push(`  ${' '.repeat(gutter)} | ${' '.repeat(column - 1)}^`);
    }
  }
  return out.join('\n');
}

/**
 * Build a dev error frame from an error. DEV-ONLY (the caller gates on `dev`).
 *
 * `opts.url` stamps the frame with the request URL that produced it (#1047).
 * Only a `render` frame carries one, and the browser overlay uses it to refuse a
 * frame belonging to a page the tab is not looking at (another tab's crash, a
 * background render of some other url, a page navigated away from). A frame with
 * no url renders unconditionally, which is what a `rebuild` / `ts-strip` frame
 * wants: those describe a still-broken build, not one URL.
 *
 * A speculative link prefetch is NOT in that list, and cannot be: `dev.js` drops
 * the report hook for one, so no frame is ever built for it to refuse.
 *
 * @param {unknown} error
 * @param {{ kind?: 'render' | 'ts-strip' | 'rebuild', appDir?: string, file?: string, line?: number, column?: number, hint?: string, url?: string }} [opts]
 * @returns {{ kind: string, message: string, stack: string|null, file: string|null, line: number|null, column: number|null, codeFrame: string|null, hint: string|null, url: string|null }}
 */
export function buildDevErrorFrame(error, opts = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  const kind = opts.kind || 'render';
  const stack = typeof err.stack === 'string' ? err.stack : null;
  // An explicit file (the ts-strip case, where the strip error names the .ts
  // file + position) wins over stack parsing; otherwise parse the stack.
  let file = opts.file || null;
  let line = opts.line != null ? opts.line : null;
  let column = opts.column != null ? opts.column : null;
  if (!file && stack) {
    const loc = parseStackLocation(stack, opts.appDir);
    if (loc) { file = loc.file; line = loc.line; column = loc.column; }
  }
  // An explicit file (the ts-strip case) but no line: Node's strip error embeds
  // the offending position as `file:line:col` in its MESSAGE, so mine the
  // message (and stack) for a location pointing at that same file.
  if (file && line == null) {
    const loc = parseStackLocation(`${err.message}\n${stack || ''}`, opts.appDir);
    if (loc && loc.file === file) { line = loc.line; column = loc.column; }
  }
  const codeFrame = file && line ? readCodeFrame(file, line, column || 0) : null;
  return {
    kind,
    message: err.message || String(err),
    stack,
    file,
    line,
    column,
    codeFrame,
    hint: opts.hint || null,
    url: typeof opts.url === 'string' && opts.url ? opts.url : null,
  };
}
