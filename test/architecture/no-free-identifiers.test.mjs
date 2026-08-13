/**
 * Every function a module CALLS must be declared in it or imported into it.
 *
 * A split moves code between files, and the failure it produces over and over
 * is a call left behind without its import. That is invisible to a unit test
 * unless the test happens to reach the line, and this branch shipped four of
 * them: `findAnchorInPath` in the router's click handler (a real click only),
 * `exists` in the dev handler (swallowed by its own try/catch), and
 * `reachableFromEntries` plus `renderToString` (one behind a warm-up, one
 * inside a ReadableStream, so both surfaced as a wrong result rather than a
 * throw).
 *
 * The check is deliberately narrow. It only looks at BARE CALLS, `foo(...)`
 * with no `.` in front, which is the exact shape a lost import produces, and it
 * ignores anything that could be a local, a parameter, a property, or a global.
 * Narrow keeps it sound: a name it cannot resolve is reported, and everything
 * ambiguous is skipped rather than guessed at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

const TREES = [
  'packages/core/src/router-client',
  'packages/core/src/render-client',
  'packages/core/src/render-server',
  'packages/core/src/component',
  'packages/core/src/slot',
  'packages/server/src/dev',
  'packages/server/src/vendor',
  'packages/server/src/ssr',
  'packages/server/src/check',
  'packages/cli/lib/doctor',
];

/** Names that are always available and are never an import. */
const GLOBALS = new Set([
  'require', 'import', 'fetch', 'structuredClone', 'queueMicrotask', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'setImmediate', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'btoa', 'atob', 'getComputedStyle', 'matchMedia',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Symbol', 'BigInt', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
  'Proxy', 'Reflect', 'JSON', 'Math', 'Intl', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'AbortController', 'AbortSignal',
  'ReadableStream', 'WritableStream', 'TransformStream', 'Uint8Array', 'Int8Array', 'Uint16Array',
  'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView',
  'Event', 'CustomEvent', 'EventTarget', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'PerformanceObserver', 'IdleDeadline', 'CSSStyleSheet', 'DOMParser', 'Range', 'Image', 'WebSocket',
  'XMLHttpRequest', 'Worker', 'SharedWorker', 'EventSource', 'Notification', 'FinalizationRegistry',
  'AggregateError', 'Function', 'escape', 'unescape', 'queueMicrotask',
]);

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'await', 'function', 'class',
  'do', 'else', 'throw', 'delete', 'void', 'in', 'of', 'instanceof', 'yield', 'super', 'this',
  'constructor', 'get', 'set', 'async', 'static', 'try', 'finally', 'case', 'default', 'export',
  'import', 'const', 'let', 'var', 'extends', 'implements',
]);

/** Strip comments, strings, template literals and regex literals. */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prevMeaningful = '';
  while (i < n) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (two === '/*') { i += 2; while (i < n && src.slice(i, i + 2) !== '*/') i += 1; i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; i += 1;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      i += 1; out += ' '; prevMeaningful = 'x'; continue;
    }
    if (c === '`') {
      i += 1;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src.slice(i, i + 2) === '${') { depth += 1; i += 2; out += ' ( '; continue; }
        if (depth > 0 && src[i] === '}') { depth -= 1; i += 1; out += ' ) '; continue; }
        if (depth === 0 && src[i] === '`') break;
        if (depth > 0) { out += src[i]; i += 1; continue; }
        i += 1;
      }
      i += 1; prevMeaningful = 'x'; continue;
    }
    if (c === '/' && !'})]'.includes(prevMeaningful) && !/[\w$]/.test(prevMeaningful)) {
      // regex literal
      i += 1;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        else if (src[i] === '\n') break;
        i += 1;
      }
      i += 1; out += ' '; prevMeaningful = 'x'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prevMeaningful = c;
    i += 1;
  }
  return out;
}

function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('no split module calls a function it neither declares nor imports', () => {
  /** @type {string[]} */
  const problems = [];

  for (const tree of TREES) {
    for (const file of jsFiles(join(REPO, tree))) {
      const raw = readFileSync(file, 'utf8');
      const code = stripNonCode(raw);

      const known = new Set([...GLOBALS, ...KEYWORDS]);
      // imported bindings (named, default and namespace)
      for (const m of raw.matchAll(/import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g)) {
        const clause = m[1];
        const braced = clause.match(/\{([\s\S]*?)\}/);
        if (braced) for (const part of braced[1].split(',')) {
          const nm = part.trim().split(/\s+as\s+/).pop().trim();
          if (nm) known.add(nm);
        }
        const head = clause.replace(/\{[\s\S]*?\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
        if (head) known.add(head.replace(/^\*\s+as\s+/, '').trim());
      }
      // declarations of every shape that can hold a callable
      for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
      for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
      // destructured bindings, params and catch bindings, conservatively
      for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(',')) {
          const nm = part.trim().split(':').pop().trim().replace(/=.*$/, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(nm)) known.add(nm);
        }
      }
      for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) {
        for (const part of m[1].split(',')) {
          const nm = part.trim().replace(/=.*$/, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(nm)) known.add(nm);
        }
      }
      for (const m of code.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g)) {
        for (const part of m[1].split(',')) {
          const nm = part.trim().replace(/=.*$/, '').replace(/^\.\.\./, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(nm)) known.add(nm);
        }
      }
      for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
      // object-literal method shorthand and class methods: `foo(a) {`, which in
      // a class body sit at an indent after `}` or a newline rather than after
      // a `,` or `{`.
      for (const m of code.matchAll(/(?:^|[,{;}]\s*)([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) known.add(m[1]);
      for (const m of code.matchAll(/^[ \t]*(?:static\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) known.add(m[1]);

      // bare calls: not preceded by `.`, `?.`, `function `, `new `
      for (const m of code.matchAll(/(^|[^.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[2];
        if (known.has(name)) continue;
        const before = code.slice(Math.max(0, m.index - 12), m.index + m[0].length - name.length - 1);
        if (/\b(function|new|class)\s*$/.test(before)) continue;
        // Final gate, deliberately generous: if the name appears ANYWHERE in
        // the raw file in a position that could bind it, treat it as known.
        // A lost import is the one shape where a name appears only ever as a
        // call, so this keeps the check sound in the safe direction, at the
        // cost of missing a name that is also, say, a property somewhere.
        // NOT `NAME,` or `,NAME`: a call ARGUMENT satisfies both, so accepting
        // them made this blind to exactly the defect it exists for. A lost
        // `publishedBuildId` import, called as
        // `headers.set('x-webjs-build', publishedBuildId())`, passed.
        const bindsHere = new RegExp(
          `(?:function|class|const|let|var)\\s+${name}\\b`
          + `|\\b${name}\\s*[:=][^=]`
          + `|\\b${name}\\s*\\([^()]*\\)\\s*\\{`,
        );
        if (bindsHere.test(raw)) continue;
        // A nested template literal inside an interpolation defeats the
        // stripper's depth tracking and leaks markup, where `<script${n}>`
        // reads as a call to `script`. A name written as an HTML tag in this
        // file is that leak, not a call.
        if (new RegExp(`<${name}\\b`).test(raw)) continue;
        problems.push(`${relative(REPO, file).split('\\').join('/')}: calls \`${name}(\` but never declares or imports it`);
      }
    }
  }

  const unique = [...new Set(problems)].sort();
  assert.deepEqual(unique, [], `free identifiers (a lost import from a split):\n  ${unique.join('\n  ')}`);
});
