/**
 * Find test code that reaches a third-party host (#1150).
 *
 * Split out from `test/repo-health/live-cdn-callers.test.mjs` so the analysis
 * can be exercised against inline fixtures rather than only against whatever
 * the tree happens to contain today. That is not a style preference: the first
 * version of the guard was file-level, and measured against the pre-PR tree it
 * flagged NEITHER of the two files the change converts. `vendor.test.js`
 * carried a live `fetch('https://api.jspm.io/generate')` and four unwrapped
 * vendor entry points, and a single `withMockedFetch` elsewhere in the same
 * file exempted all of it. A guard with an empty counterfactual is worse than
 * no guard, because it reads as protection.
 *
 * So the exemption is PER CALL. A live host or a vendor entry point is fine
 * only where it sits lexically inside a `withMockedFetch(...)` or
 * `withJspmDouble(...)` argument list, which is the shape that actually
 * controls `globalThis.fetch` for the duration of that call.
 *
 * The second exemption is an explicit per-site marker, `// live-cdn-ok: why`,
 * on or just above the call. Several entry-point calls genuinely cannot reach
 * the network (a `pinAll` on an app with no resolvable bare imports returns
 * before the resolve, an `auditPinned` with no pin file short-circuits, a
 * provider-validation test rejects before dialling), and wrapping those in a
 * double to satisfy a checker would be churn that teaches the wrong thing. The
 * marker records the reason at the site instead. It is deliberately noisy to
 * add, so it is a decision rather than a default, and unlike the file-level
 * flag it replaced it exempts exactly one call.
 *
 * This module has NO side effects.
 */

/** Third-party hosts no required check may depend on. */
export const LIVE_HOSTS = ['api.jspm.io', 'ga.jspm.io', 'registry.npmjs.org'];

/**
 * Vendor entry points that reach a live host internally, so naming one is as
 * live as calling fetch yourself.
 */
export const LIVE_ENTRY_POINTS = ['pinAll', 'updatePinned', 'auditPinned', 'findOutdated'];

/** Helpers that install a `fetch` the test controls for the duration of a call. */
const GUARDS = ['withMockedFetch', 'withJspmDouble'];

/**
 * Blank out comments, strings, template literals, and REGEX literals, replacing
 * each with same-length filler so every index still lines up with the original
 * source.
 *
 * Preserving offsets is what lets the guarded-range scan below run on the
 * masked text and still report positions in the real file. Blanking strings
 * matters for two different reasons: a host named inside a mock's expected-url
 * string is not a call, and an unbalanced parenthesis inside a string would
 * otherwise wreck the paren matching.
 *
 * Regex literals are the subtle one, and skipping them is not a rounding
 * error: this suite is full of patterns like
 * `/rel=["']modulepreload["']/`, whose quote characters would otherwise be
 * read as string delimiters. That desyncs the mask for the REST OF THE FILE,
 * so every live call below such a line silently disappears from the scan.
 * Eighteen test files here carry that shape, including the app-boot tests, so
 * a masker without this is a guard that reports clean because it went blind.
 *
 * Telling a regex from a division needs the preceding token, since `/` is
 * both. The usual heuristic applies: a regex may start where a VALUE may not
 * have just ended, so after an operator, an opening bracket, a comma, a
 * semicolon, or a keyword like `return`, but not after an identifier, a
 * number, or a closing bracket.
 *
 * @param {string} src
 * @returns {string}
 */
/** Keywords after which a `/` opens a regex rather than dividing. */
const REGEX_PRECEDING_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

export function maskLiterals(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  /** The last token character that was not whitespace and not masked away. */
  let prev = '';
  /** The identifier immediately before `prev`, when `prev` ends a word. */
  let prevWord = '';

  const regexCanStartHere = () => {
    if (!prev) return true;
    if (/[)\]}]/.test(prev)) return false;
    if (/[A-Za-z0-9_$]/.test(prev)) return REGEX_PRECEDING_WORDS.has(prevWord);
    return true;
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (c === '/' && regexCanStartHere()) {
      // Scan to the closing delimiter, honouring escapes and character
      // classes (a `/` inside `[...]` does not end the literal).
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        blank(i + 1, j); prev = '/'; prevWord = ''; i = j + 1; continue;
      }
      // An unterminated `/` was a division after all. Fall through.
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      // Blank the CONTENTS but keep the quotes, so a masked string is still
      // recognisably a string and cannot merge with the token beside it.
      blank(i + 1, j); prev = c; prevWord = ''; i = j + 1; continue;
    }
    if (!/\s/.test(c)) {
      if (/[A-Za-z0-9_$]/.test(c)) {
        prevWord = /[A-Za-z0-9_$]/.test(prev) ? prevWord + c : c;
      } else {
        prevWord = '';
      }
      prev = c;
    }
    i++;
  }
  return out.join('');
}

/**
 * Index of the `)` matching the `(` at `openIdx`, or -1.
 * @param {string} masked @param {number} openIdx
 */
function matchParen(masked, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < masked.length; k++) {
    if (masked[k] === '(') depth++;
    else if (masked[k] === ')') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Character ranges covered by a `withMockedFetch(` / `withJspmDouble(` call,
 * from its opening parenthesis to its match.
 *
 * @param {string} masked  output of {@link maskLiterals}
 * @returns {Array<[number, number]>}
 */
export function guardedRanges(masked) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  for (const guard of GUARDS) {
    const re = new RegExp(`\\b${guard}\\s*\\(`, 'g');
    for (const m of masked.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(masked, open);
      if (close !== -1) ranges.push([open, close]);
    }
  }
  return ranges;
}

/**
 * Live callers in one file, each with the 1-indexed line it sits on.
 *
 * @param {string} src
 * @returns {Array<{ kind: 'host' | 'entry', what: string, line: number }>}
 */
export function findLiveCallers(src) {
  const masked = maskLiterals(src);
  const ranges = guardedRanges(masked);
  const lines = src.split('\n');
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  const inGuard = (idx) => ranges.some(([a, b]) => idx > a && idx < b);
  // The marker is read from the ORIGINAL source, since masking blanks
  // comments. Three lines of lookback, so it can sit above a call that wraps.
  const marked = (line) => lines
    .slice(Math.max(0, line - 4), line)
    .some((l) => l.includes('live-cdn-ok:'));
  const guarded = (idx) => inGuard(idx) || marked(lineAt(idx));

  /** @type {Array<{ kind: 'host' | 'entry', what: string, line: number }>} */
  const found = [];

  // A host literal has to be read from the ORIGINAL source, since masking
  // blanks string contents. Only the BOUNDS come from the mask, and they are
  // the call's actual argument list rather than a fixed character window: a
  // window crosses statement boundaries, so `fetch(localUrl)` followed two
  // lines later by an assertion naming a jspm url read as a live call. The
  // same host in an assertion, a comment, or an importmap fixture is inert,
  // and this suite is full of those on purpose.
  for (const m of masked.matchAll(/\bfetch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(masked, open);
    if (close === -1) continue;
    const arg = src.slice(open + 1, close);
    const host = LIVE_HOSTS.find((h) => arg.includes(h));
    if (host && !guarded(m.index)) found.push({ kind: 'host', what: host, line: lineAt(m.index) });
  }

  for (const fn of LIVE_ENTRY_POINTS) {
    for (const m of masked.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'g'))) {
      if (!guarded(m.index)) found.push({ kind: 'entry', what: fn, line: lineAt(m.index) });
    }
  }

  return found.sort((a, b) => a.line - b.line);
}
