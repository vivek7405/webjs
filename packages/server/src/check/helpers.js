import { sep } from 'node:path';
import { matchClosingBrace } from '../js-scan.js';

/**
 * Check whether a file has the `'use server'` directive in its first
 * five lines.
 * @param {string} content file content (already read)
 * @returns {boolean}
 */
export function hasUseServerDirective(content) {
  const head = content.split('\n').slice(0, 5).join('\n');
  return /^\s*(['"])use server\1\s*;?\s*$/m.test(head);
}

/**
 * Check whether a file is a server action.
 * @param {string} filePath absolute path
 * @param {string} content file content (already read)
 * @returns {boolean}
 */
export function isServerActionFile(filePath, content) {
  if (!/\.server\.m?[jt]s$/.test(filePath)) return false;
  return hasUseServerDirective(content);
}

/**
 * Check whether a file resides under a components/ directory (shared or
 * module-scoped).
 * @param {string} relPath path relative to appDir
 * @returns {boolean}
 */
export function isComponentFile(relPath) {
  const segments = relPath.split(sep);
  return segments.includes('components');
}

/**
 * True when a factory prop value is an array-typed `prop<…>(…)` whose
 * runtime constructor argument is `Object`.
 * @param {string} value the raw prop value text, e.g. `prop<Tag[]>(Object)`
 * @returns {boolean}
 */
export function arrayPropUsesObject(value) {
  const m = /^prop\s*<([\s\S]*)>\s*\(\s*Object\s*[,)]/.exec(value.trim());
  if (!m) return false;
  return isArrayTypeText(m[1]);
}

/**
 * True when a TypeScript type expression denotes an array.
 * @param {string} type
 * @returns {boolean}
 */
export function isArrayTypeText(type) {
  const bare = type.trim().replace(/^readonly\s+/, '');
  if (/\[\s*\]$/.test(bare)) return true;
  if (/^(?:Readonly)?Array\s*<[\s\S]*>$/.test(bare)) return true;
  return false;
}

/**
 * Scan a class body for class-field initializers naming any of `props`.
 * @param {string} classBody
 * @param {Set<string>} props
 * @returns {string[]}
 */
export function findFieldInitializers(classBody, props) {
  /** @type {string[]} */
  const out = [];
  const n = classBody.length;
  const initRe = /^\s*(?:(public|private|protected|readonly)\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?\s*=\s*[^=>]/;
  const typeOnlyRe = /^\s*(?:(public|private|protected|readonly)\s+)?([A-Za-z_$][\w$]*)\s*[!?]?\s*:\s*\S/;
  const examineLine = (lineStart) => {
    let j = lineStart;
    while (j < n && classBody[j] !== '\n') j++;
    const line = classBody.slice(lineStart, j);
    const initM = initRe.exec(line);
    const typeM = typeOnlyRe.exec(line);
    const name = initM ? initM[2] : (typeM ? typeM[2] : null);
    if (name && name !== 'declare' && name !== 'static' && props.has(name)) out.push(name);
  };
  let depth = 0;
  let i = 0;
  let lineStart = 0;
  let examined = false;
  let str = '';
  while (i < n) {
    const c = classBody[i];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = '';
      i++;
      continue;
    }
    if (c === '\n') { lineStart = i + 1; examined = false; i++; continue; }
    if (c === '/' && classBody[i + 1] === '/') {
      while (i < n && classBody[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && classBody[i + 1] === '*') {
      i += 2;
      while (i < n && !(classBody[i] === '*' && classBody[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    if (depth === 0 && !examined && !/\s/.test(c)) {
      examined = true;
      examineLine(lineStart);
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    i++;
  }
  return out;
}

const BROWSER_GLOBALS = [
  'document', 'window', 'localStorage', 'sessionStorage', 'navigator',
  'matchMedia', 'requestAnimationFrame', 'getComputedStyle',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver',
];

const HTMLELEMENT_MEMBERS = [
  'attachShadow', 'shadowRoot', 'classList',
  'querySelector', 'querySelectorAll', 'getBoundingClientRect',
  'focus', 'blur', 'scrollIntoView',
];

/**
 * Extract the body text of a named method from a class body.
 * @param {string} classBody
 * @param {string} name
 */
export function methodBodyOf(classBody, name) {
  const re = new RegExp(`(?:^|[\\s;}])(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`, 'g');
  const m = re.exec(classBody);
  if (!m) return '';
  const open = classBody.indexOf('{', m.index + m[0].length - 1);
  if (open === -1) return '';
  const close = matchClosingBrace(classBody, open + 1);
  return close === -1 ? '' : classBody.slice(open + 1, close);
}

/**
 * Find browser-only globals and HTMLElement `this.<member>` accesses in code.
 * @param {string} code
 * @returns {{ member: string, kind: string }[]}
 */
export function findBrowserMemberUses(code) {
  code = code
    .replace(/'(?:[^'\\]|\\.)*'/g, (s) => `'${' '.repeat(Math.max(0, s.length - 2))}'`)
    .replace(/"(?:[^"\\]|\\.)*"/g, (s) => `"${' '.repeat(Math.max(0, s.length - 2))}"`);
  const out = [];
  const seen = new Set();
  const gRe = new RegExp(`(?<![.\\w$])(${BROWSER_GLOBALS.join('|')})\\b`, 'g');
  let m;
  while ((m = gRe.exec(code)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ member: m[1], kind: 'a browser global' });
  }
  const hRe = new RegExp(`\\bthis\\.(${HTMLELEMENT_MEMBERS.join('|')})\\b`, 'g');
  while ((m = hRe.exec(code)) !== null) {
    const key = `this.${m[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ member: key, kind: 'an HTMLElement member' });
  }
  return out;
}

/**
 * True if any `export const/let/var` declares more than one binding.
 * @param {string} scan
 * @returns {boolean}
 */
export function hasMultiDeclaratorExport(scan) {
  const re = /\bexport\s+(?:const|let|var)\b/g;
  let m;
  while ((m = re.exec(scan))) {
    let depth = 0;
    let angle = 0;
    let seenEq = false;
    let inType = false;
    for (let i = m.index + m[0].length; i < scan.length; i++) {
      const ch = scan[i];
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; continue; }
      if (depth !== 0) continue;
      if (ch === ';') break;
      if (ch === '=') { seenEq = true; inType = false; angle = 0; continue; }
      if (ch === ':' && !seenEq) { inType = true; continue; }
      if (inType && ch === '<') { angle++; continue; }
      if (inType && ch === '>' && scan[i - 1] !== '=') { if (angle > 0) angle--; continue; }
      if (ch === ',' && !(inType && angle > 0)) return true;
    }
  }
  return false;
}

/**
 * Enumerate a module's provable named exports from its redacted `scan`.
 * @param {string} scan
 * @returns {Set<string>|null}
 */
export function enumerableExports(scan) {
  if (/\bexport\s*\*/.test(scan)) return null;
  if (/\bexport\s+(?:const|let|var)\s*[{[]/.test(scan)) return null;
  if (hasMultiDeclaratorExport(scan)) return null;
  const names = new Set();
  let m;
  const collect = (re) => { while ((m = re.exec(scan))) names.add(m[1]); };
  collect(/\bexport\s+(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)/g);
  collect(/\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g);
  collect(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  collect(/\bexport\s+(?:type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g);
  if (/\bexport\s+default\b/.test(scan)) names.add('default');
  const reClause = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((m = reClause.exec(scan))) {
    for (let part of m[1].split(',')) {
      part = part.trim().replace(/^type\s+/, '');
      if (!part) continue;
      const name = part.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * The `{ local, imported }` pairs a named import clause binds.
 * @param {string} clause
 * @returns {{ local: string, imported: string }[]}
 */
export function importedLocalNames(clause) {
  if (/^\s*type\b/.test(clause)) return [];
  const brace = clause.match(/\{([^}]*)\}/);
  if (!brace) return [];
  /** @type {{ local: string, imported: string }[]} */
  const out = [];
  for (const part of brace[1].split(',')) {
    const seg = part.trim().replace(/^type\s+/, '');
    if (!seg) continue;
    const as = seg.split(/\s+as\s+/);
    const imported = as[0].trim();
    const local = (as[1] || as[0]).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(local) && /^[A-Za-z_$][\w$]*$/.test(imported)) {
      out.push({ local, imported });
    }
  }
  return out;
}

/**
 * The NAMED VALUE names a single `import { ... } from` clause pulls in.
 * @param {string} clause
 * @returns {string[]|null}
 */
export function importedValueNames(clause) {
  if (/^\s*type\b/.test(clause)) return null;
  const brace = clause.match(/\{([^}]*)\}/);
  if (!brace) return [];
  return brace[1].split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^type\s/.test(s))
    .map((s) => s.split(/\s+as\s+/)[0].trim())
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}
