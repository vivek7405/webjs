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
 * Blank out comments, strings, and template literals, replacing each with
 * same-length filler so every index still lines up with the original source.
 *
 * Preserving offsets is what lets the guarded-range scan below run on the
 * masked text and still report positions in the real file. Blanking strings
 * matters for two different reasons: a host named inside a mock's expected-url
 * string is not a call, and an unbalanced parenthesis inside a string would
 * otherwise wreck the brace matching.
 *
 * @param {string} src
 * @returns {string}
 */
export function maskLiterals(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
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
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      // Blank the CONTENTS but keep the quotes, so a masked string is still
      // recognisably a string and cannot merge with the token beside it.
      blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
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
      let depth = 0;
      for (let k = open; k < masked.length; k++) {
        if (masked[k] === '(') depth++;
        else if (masked[k] === ')') {
          depth--;
          if (depth === 0) { ranges.push([open, k]); break; }
        }
      }
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
  // blanks string contents. Only its position is taken from the mask, and a
  // `fetch(` whose argument names a live host is what counts; the same host in
  // an assertion or an importmap fixture is inert, and the suite is full of
  // those on purpose.
  for (const m of masked.matchAll(/\bfetch\s*\(/g)) {
    const argStart = m.index + m[0].length;
    const arg = src.slice(argStart, argStart + 200);
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
