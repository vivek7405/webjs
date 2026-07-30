import { html } from '@webjsdev/core';
import type { TemplateResult } from '@webjsdev/core';

/**
 * Tiny SSR-time syntax highlighter for the marketing code samples.
 *
 * It runs during server render and emits colored <span>s. Token text is
 * passed through `html` text interpolation, which escapes it, so a
 * sample can contain real backticks, angle brackets, and ${...} without
 * any manual escaping (the sample lives in a plain JS string, never
 * inside an html`` body). The token classes (t-kw, t-str, ...) are
 * styled once in the page stylesheet and are theme-aware.
 *
 * This is a display highlighter, not a full parser. It is deliberately
 * small and covers the JS and TS surface the samples use.
 */

type Tok = { t: string; v: string };

// 'get'/'set' are deliberately NOT keywords: they are contextual (only
// keywords in a getter/setter declaration), and the keyword check runs before
// the call heuristic, so listing them would mis-color a `.get(` / `.set(`
// method call (e.g. the signal API on the flagship sample) as a keyword.
const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'async', 'function', 'return',
  'const', 'let', 'var', 'await', 'new', 'class', 'extends', 'if', 'else',
  'for', 'of', 'in', 'true', 'false', 'null', 'undefined', 'this', 'typeof',
  'throw', 'try', 'catch', 'void', 'static', 'as',
]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  const push = (t: string, v: string) => { if (v) out.push({ t, v }); };

  while (i < n) {
    const c = src[i];

    // whitespace
    if (c === ' ' || c === '\t' || c === '\n') {
      let j = i + 1;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
      push('ws', src.slice(i, j));
      i = j;
      continue;
    }

    // line comment
    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      push('com', src.slice(i, j));
      i = j;
      continue;
    }

    // block comment
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      push('com', src.slice(i, j));
      i = j;
      continue;
    }

    // strings (single, double, backtick), treated as a flat string
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      j = Math.min(n, j + 1);
      push('str', src.slice(i, j));
      i = j;
      continue;
    }

    // numbers
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[0-9._a-fxA-FX]/.test(src[j])) j++;
      push('num', src.slice(i, j));
      i = j;
      continue;
    }

    // identifiers
    if (/[A-Za-z_$@]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < n && src[k] === ' ') k++;
      if (KEYWORDS.has(word)) push('kw', word);
      else if (src[k] === '(') push('fn', word);
      else if (/^[A-Z]/.test(word)) push('type', word);
      else push('id', word);
      i = j;
      continue;
    }

    // punctuation
    push('punc', c);
    i++;
  }
  return out;
}

const CLASS: Record<string, string> = {
  com: 't-com', str: 't-str', num: 't-num', kw: 't-kw',
  fn: 't-fn', type: 't-type', punc: 't-punc', id: 't-id', ws: '',
};

/** Highlight a code sample into a TemplateResult of styled spans. */
export function highlight(code: string): TemplateResult[] {
  return tokenize(code.replace(/^\n+|\n+$/g, '')).map((tok) => {
    const cls = CLASS[tok.t] ?? '';
    return cls ? html`<span class=${cls}>${tok.v}</span>` : html`${tok.v}`;
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Highlight a code sample into an HTML string of styled spans, for callers
 * that build markup as a string rather than an `html` TemplateResult (the
 * blog markdown renderer, `modules/blog/utils/render-post.ts`). Same
 * tokenizer and token classes as `highlight()`, so the colors match every
 * other WebJs surface. Token text is HTML-escaped, so a sample can contain
 * `<`, `&`, and backticks safely.
 */
export function highlightToHtml(code: string): string {
  return tokenize(code.replace(/^\n+|\n+$/g, '')).map((tok) => {
    const cls = CLASS[tok.t] ?? '';
    const v = esc(tok.v);
    return cls ? `<span class="${cls}">${v}</span>` : v;
  }).join('');
}
