/**
 * The registry component `@example` block: extract it, strip it (#983).
 *
 * A Tier-1 component file is a handful of class-helper functions plus a module
 * JSDoc whose `@example` block carries the ACCESSIBLE STRUCTURE an author
 * composes (the `<details name>` exclusive-open wiring, the `group-open`
 * chevron, the `aria-*` attributes). That worked example is BUILD-TIME
 * guidance, consumed once while composing, so it should NOT persist in the
 * copied project file as dead boilerplate. This module is the single source of
 * truth for that block:
 *
 * - {@link extractExample} pulls the paste-ready snippet out (for `webjsui view`
 *   and the MCP `ui` tool, which serve it on demand without copying it in).
 * - {@link stripExample} removes it from the file `add` writes and leaves a
 *   one-line pointer, so the copied file keeps only the helpers + a lean header.
 *
 * Both key on the SAME `@example` delimiter in the module JSDoc, so the snippet
 * has exactly one home (the JSDoc) and cannot drift from a parallel field.
 * Hand-rolled (no JSDoc/markdown parser dependency: `@webjsdev/ui` ships no
 * third-party runtime deps).
 *
 * @module registry/example
 */

/**
 * Locate the first block comment (`/** ... *\/`), i.e. the module JSDoc.
 *
 * @param {string} src
 * @returns {{ start: number, end: number, text: string } | null}
 */
function firstBlockComment(src) {
  const start = src.indexOf('/**');
  if (start === -1) return null;
  const end = src.indexOf('*/', start + 3);
  if (end === -1) return null;
  return { start, end: end + 2, text: src.slice(start, end + 2) };
}

/**
 * True when the module JSDoc carries an `@example` block.
 *
 * @param {string} src
 * @returns {boolean}
 */
export function hasExample(src) {
  const block = firstBlockComment(src);
  return !!block && /^\s*\*\s*@example\b/m.test(block.text);
}

/**
 * Extract the paste-ready example snippet from the module JSDoc. Returns the
 * fenced code (unwrapped) when the `@example` body is a ```` ```lang ```` block,
 * else the de-indented text. Empty string when there is no `@example`.
 *
 * @param {string} src
 * @returns {string}
 */
export function extractExample(src) {
  const block = firstBlockComment(src);
  if (!block) return '';
  const lines = block.text.split('\n');
  const exIdx = lines.findIndex((l) => /^\s*\*\s*@example\b/.test(l));
  if (exIdx === -1) return '';
  // Everything after the @example line, up to the closing */ OR the next JSDoc
  // tag (so a trailing @see / @module after the example is not captured).
  const bodyLines = [];
  for (let i = exIdx + 1; i < lines.length; i++) {
    if (/^\s*\*\/\s*$/.test(lines[i])) break; // closing */
    if (/^\s*\*\s*@\w+/.test(lines[i])) break; // next tag ends the example body
    // Strip the leading ` * ` JSDoc gutter, preserving inner indentation.
    bodyLines.push(lines[i].replace(/^\s*\*\s?/, ''));
  }
  let body = bodyLines.join('\n').replace(/\s+$/, '');
  // Unwrap a fenced code block if the example is wrapped in one.
  const fence = body.match(/^\s*```[A-Za-z0-9]*\n([\s\S]*?)\n```\s*$/);
  if (fence) body = fence[1];
  return body.replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * The one-line pointer left in place of a stripped example. Uses the EXPLICIT
 * `npx @webjsdev/ui view` form, not the bare `webjsui` bin name. `webjsui` is a
 * bin declared INSIDE `@webjsdev/ui` and is not a published package name (the
 * registry 404s on it), so `npx webjsui` resolves only where the kit is already
 * a direct dep. It is not one in a scaffolded app, where `@webjsdev/ui` is
 * intentionally unpinned (packages/cli/lib/create.js). The explicit form works
 * in a WebJs app and a standalone project alike, and every command hint this
 * package prints uses it for the same reason (#1264). The commander banner is
 * the one exception, since `.name('webjsui')` in index.js is the bin's real
 * identifier rather than a command being suggested to a reader.
 */
export function pointerLine(name) {
  return `Full usage example: npx @webjsdev/ui view ${name}  (or the MCP tool: ui ${name})`;
}

/**
 * Remove the `@example` block from the module JSDoc and leave a one-line
 * pointer to `webjsui view` / the MCP `ui` tool. No-op when there is no
 * `@example`. This runs at `add` write-time so the copied project file keeps
 * only the helpers + a lean header, not the worked example.
 *
 * @param {string} src
 * @param {string} name  the component name, for the pointer
 * @returns {string}
 */
export function stripExample(src, name) {
  const block = firstBlockComment(src);
  if (!block) return src;
  const lines = block.text.split('\n');
  const exIdx = lines.findIndex((l) => /^\s*\*\s*@example\b/.test(l));
  if (exIdx === -1) return src;
  const head = lines.slice(0, exIdx);
  // Preserve any JSDoc tags that follow the @example block (so a trailing
  // @see / @module survives the strip). The example body ends at the next tag
  // line or the closing */.
  const tail = [];
  for (let i = exIdx + 1; i < lines.length; i++) {
    if (/^\s*\*\/\s*$/.test(lines[i])) break;
    if (/^\s*\*\s*@\w+/.test(lines[i])) { tail.push(...lines.slice(i, lines.length - 1)); break; }
  }
  // Drop trailing blank JSDoc gutter lines (` *`) so we don't double the gap.
  while (head.length && /^\s*\*\s*$/.test(head[head.length - 1])) head.pop();
  const rebuilt = [...head, ' *', ` * ${pointerLine(name)}`, ...tail, ' */'].join('\n');
  return src.slice(0, block.start) + rebuilt + src.slice(block.end);
}
