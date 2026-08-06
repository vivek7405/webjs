/**
 * Low-level lexical scanning helpers shared by the convention validator
 * (`check.js`) and the component-elision analyser (`component-elision.js`).
 *
 * These are deliberately a hand-rolled lexer, NOT a full TS parse. The
 * framework prioritises fast dev-time rebuilds; a real parser would be ~50x
 * slower for patterns this shallow. The lexer tracks the JS lexical grammar
 * (strings, regex literals, comments, and templates with nested `${...}`
 * interpolation) so structural scanners never trip on a literal's contents.
 */

/**
 * Keywords after which a `/` opens a regex literal rather than dividing
 * (`return /re/`, `typeof /re/`). After a plain identifier or number a `/` is
 * division. Used by the lexer's regex-versus-division decision.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'case', 'yield', 'await', 'throw',
]);

/**
 * Return `src` with the BODY of every comment, single-quoted string,
 * double-quoted string, and template literal replaced by spaces (with
 * newlines preserved). Quote delimiters / comment markers themselves
 * are kept so the brace counter and other structural scanners still
 * see the surrounding shape. Positions (line + column) are preserved
 * exactly, so a violation reported against the redacted source maps
 * back to the same line/column in the original.
 *
 * The point: lint rules that pattern-match across raw source (regex
 * for `class X extends WebComponent`, `enum`, `register('tag')`,
 * etc.) must not match the same pattern when it appears as a
 * code-example string INSIDE an `html\`...\`` template body. Docs
 * pages legitimately render such examples to teach users; without
 * redaction the scanner reads them as real declarations and emits
 * false positives.
 *
 * Template literals split by tag + shape:
 *
 * Preserved verbatim only when ALL of: untagged, no newline in the
 * body, no `${...}` interpolation. This is the "backticks as a
 * quote-style alias" shape, e.g. `` register(`my-tag`) ``, where
 * the backtick literal is morally a short string argument. Lint
 * rules then read it the same way they read `register('my-tag')`.
 *
 * Blanked in every other case:
 *   (a) TAGGED templates like `` html`...` ``, `` css`...` ``,
 *       `` Class.method`...` ``, which carry multi-line code-shaped
 *       strings in docs pages and JSDoc examples.
 *   (b) Multi-line untagged literals, typically code-shaped
 *       fixtures the linter should not read in place.
 *   (c) Interpolated literals; the `${...}` body is dynamic and
 *       cannot be statically validated anyway.
 *
 * A real `register('foo')` call inside a blanked region (e.g.
 * inside a tagged interpolation `` html`${X.register('foo')}` ``)
 * disappears from the lint surface. Accepted trade-off: register()
 * calls in practice live at top-level in component files, not
 * inside template interpolations.
 *
 * Regex literals ARE tracked. A `/.../` in expression position (decided by
 * the previous significant token, the standard regex-versus-division rule)
 * has its body blanked with the `/` delimiters kept, so a quote, brace, or
 * comment-like sequence inside a regex cannot desync the walker. Template
 * literals are tracked with full `${...}` interpolation and arbitrary
 * nesting, so a nested `` html`...${html`...`}...` `` is delimited correctly
 * (the inner backtick is not mistaken for the outer close).
 *
 * `blankStrings` (default false, so existing callers are byte-identical)
 * additionally blanks PLAIN string bodies and disables the verbatim-template
 * fast path, yielding a mask in which NO literal body survives. Callers that
 * only check whether a keyword sits in code position (not inside any literal),
 * e.g. the import-versioning pass, pass true so an `import '…'` written inside
 * a plain string is correctly masked out (the default mask keeps plain-string
 * bodies verbatim so `register('tag')` stays readable, which would otherwise
 * leave such a string looking like a real import).
 *
 * @param {string} src
 * @param {boolean} [blankStrings=false]  also blank plain-string + verbatim-template bodies
 * @returns {string}
 */
export function redactStringsAndTemplates(src, blankStrings = false) {
  return scanLiterals(src, { placeholder: false, blankStrings }).out;
}

/**
 * Core string / template / comment lexer shared by `redactStringsAndTemplates`
 * (#179) and `redactToPlaceholders` (#634). ONE walker owns the
 * regex-versus-division, tagged-template, and `${...}`-nesting disambiguation,
 * so the two output modes can never drift apart.
 *
 * Two output modes, selected by `placeholder`:
 *  - MASK (placeholder=false): position-preserving mask (same length, newlines
 *    kept). Comment and regex bodies blank to spaces; template bodies blank,
 *    recursing `${...}` holes as blanked code; plain-string bodies stay VERBATIM
 *    so a caller can read `register('tag')`, UNLESS `blankStrings` is set (then
 *    string bodies blank too and the verbatim-template fast path is disabled).
 *    `literals` is empty.
 *  - PLACEHOLDER (placeholder=true): each string / template-text body is
 *    replaced by a `__STR_<idx>__` token (delimiters kept) and pushed to
 *    `literals`, while `${...}` holes are scanned as REAL code. Lets a caller
 *    tell a real top-level `register(...)` / `import` from one shown inside a
 *    code-sample literal (resolve the token via `literals[idx]`). In this mode
 *    code is never blanked, so the mask emit-formulas below reduce to verbatim.
 *
 * @param {string} src
 * @param {{ placeholder?: boolean, blankStrings?: boolean }} [opts]
 * @returns {{ out: string, literals: string[] }}
 */
function scanLiterals(src, { placeholder = false, blankStrings = false } = {}) {
  const n = src.length;
  let out = '';
  let i = 0;
  const literals = [];
  // Previous significant token in code position, tracked as we walk (more
  // robust than scanning `out`, whose tail is blanked spaces inside a hole).
  // `lastSig` is the last non-whitespace source char; `lastWord` is the last
  // identifier. Both drive regex-versus-division and tagged-template decisions.
  let lastSig = '';
  let lastWord = '';
  // Whether `lastWord` was a property access (`.of`, `?.in`). A member named
  // like a keyword is a value, never a regex-preceding keyword.
  let lastWordIsProp = false;
  // Whether the last two significant chars formed a postfix `++` / `--`. A
  // postfix increment/decrement yields a value, so a following `/` is division
  // (`a++ / 2`), not a regex start. Without this the `/` opens a phantom regex
  // that blanks to the next `/`, swallowing a following module-scope call.
  let lastWasIncDec = false;
  // After a literal (string/regex/template) the next `/` is division and the
  // next backtick is a tag, so mark a value-ender.
  const markValue = () => { lastSig = 'x'; lastWord = ''; lastWordIsProp = false; lastWasIncDec = false; };

  // `/` opens a regex unless the previous token is a value (identifier that is
  // not a regex-preceding keyword, number, `)`, `]`, or a literal).
  const isRegex = () => {
    if (lastSig === '') return true;
    if (lastSig === ')' || lastSig === ']') return false;
    if (lastSig === "'" || lastSig === '"' || lastSig === '`') return false;
    if (lastWasIncDec) return false;   // postfix `a++` / `a--` is a value
    if (/[\w$]/.test(lastSig)) return !lastWordIsProp && REGEX_PRECEDING_KEYWORDS.has(lastWord);
    return true;
  };
  // A template is tagged when the previous token is a value (mask mode only).
  const isTagged = () => /[\w$)\]'"`]/.test(lastSig);

  const scanLineComment = () => {
    out += '//'; i += 2;
    while (i < n && src[i] !== '\n') { out += ' '; i++; }
  };
  const scanBlockComment = () => {
    out += '/*'; i += 2;
    while (i < n) {
      if (src[i] === '*' && src[i + 1] === '/') { out += '*/'; i += 2; return; }
      out += src[i] === '\n' ? '\n' : ' '; i++;
    }
  };
  const scanRegex = () => {
    out += '/'; i++;
    let inClass = false;
    while (i < n) {
      const d = src[i];
      if (d === '\\' && i + 1 < n) { out += '  '; i += 2; continue; }
      if (d === '\n') break;                 // unterminated regex
      if (d === '[') inClass = true;
      else if (d === ']') inClass = false;
      else if (d === '/' && !inClass) { out += '/'; i++; break; }
      out += ' '; i++;
    }
    markValue();
  };
  // Strings. PLACEHOLDER: collect the body into `literals` and emit
  // `q__STR_idx__q`. MASK: KEEP the body verbatim (so tag-name-has-hyphen can
  // read register('foo')); blank it when inside an already-blanked hole.
  const scanString = (q, blank) => {
    if (placeholder) {
      i++;
      let body = '';
      while (i < n) {
        if (src[i] === '\\' && i + 1 < n) { body += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') { i++; break; }
        body += src[i]; i++;
      }
      const idx = literals.length;
      literals.push(body);
      out += q + `__STR_${idx}__` + q;
      markValue();
      return;
    }
    out += q; i++;
    while (i < n) {
      if (src[i] === '\\' && i + 1 < n) { out += blank ? '  ' : src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === q) { out += q; i++; break; }
      if (src[i] === '\n') { out += '\n'; i++; break; }   // unterminated
      out += blank ? ' ' : src[i]; i++;
    }
    markValue();
  };
  // Template literal. PLACEHOLDER: each text segment becomes a `__STR_idx__`
  // token (collected) and each `${...}` hole is scanned as REAL code. MASK:
  // verbatim fast path for a simple closed single-line untagged literal, else
  // blank the text and recurse holes as blanked code (`forceBlank` is set when
  // already inside a blanked hole, so everything nested blanks regardless).
  const scanTemplate = (forceBlank) => {
    if (placeholder) {
      out += '`'; i++;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) {
          let body = '\\' + src[i + 1];
          i += 2;
          while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) {
            if (src[i] === '\\' && i + 1 < n) { body += src[i] + src[i + 1]; i += 2; continue; }
            body += src[i]; i++;
          }
          const idx = literals.length;
          literals.push(body);
          out += `__STR_${idx}__`;
          continue;
        }
        if (c === '`') { out += '`'; i++; break; }
        if (c === '$' && src[i + 1] === '{') {
          out += '${'; i += 2;
          scanCode(true, false);
          if (i < n && src[i] === '}') { out += '}'; i++; }
          continue;
        }
        let body = '';
        while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) {
          if (src[i] === '\\' && i + 1 < n) { body += src[i] + src[i + 1]; i += 2; continue; }
          body += src[i]; i++;
        }
        const idx = literals.length;
        literals.push(body);
        out += `__STR_${idx}__`;
      }
      markValue();
      return;
    }
    const tagged = isTagged();
    let hasInterp = false, hasNewline = false, closed = false, depth = 0, k = i + 1;
    while (k < n) {
      const ch = src[k];
      if (ch === '\\') { k += 2; continue; }
      if (depth === 0 && ch === '`') { closed = true; break; }
      if (ch === '$' && src[k + 1] === '{') { hasInterp = true; depth++; k += 2; continue; }
      else if (ch === '{' && depth > 0) depth++;
      else if (ch === '}' && depth > 0) depth--;
      if (ch === '\n') hasNewline = true;
      k++;
    }
    const verbatim = !forceBlank && !blankStrings && !tagged && closed && !hasNewline && !hasInterp;
    out += '`'; i++;
    if (verbatim) {
      while (i < n) {
        if (src[i] === '\\' && i + 1 < n) { out += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '`') { out += '`'; i++; break; }
        out += src[i]; i++;
      }
      markValue();
      return;
    }
    // Blanked template: blank the literal text, recurse through `${...}` holes
    // (scanned as blanked code, so nested templates/strings/regexes inside a
    // hole are delimited correctly and never desync the outer scan).
    while (i < n) {
      const c = src[i];
      if (c === '\\' && i + 1 < n) { out += ' '; out += src[i + 1] === '\n' ? '\n' : ' '; i += 2; continue; }
      if (c === '`') { out += '`'; i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        out += '  '; i += 2;
        scanCode(true, true);
        if (i < n && src[i] === '}') { out += ' '; i++; }
        continue;
      }
      out += c === '\n' ? '\n' : ' '; i++;
    }
    markValue();
  };

  // Scan code. `stopHole`: return at the `}` that closes the enclosing template
  // hole (the caller emits it). `blank`: emit spaces for code (inside a blanked
  // hole; mask mode only, never set in placeholder mode so the formulas below
  // reduce to verbatim). Literals are always lexed so braces/quotes inside them
  // never count.
  function scanCode(stopHole, blank) {
    let brace = 0;
    while (i < n) {
      const c = src[i], next = src[i + 1];
      if (stopHole && c === '}' && brace === 0) return;
      if (c === '/' && next === '/') { scanLineComment(); continue; }
      if (c === '/' && next === '*') { scanBlockComment(); continue; }
      if (c === '/' && isRegex()) { scanRegex(); continue; }
      if (c === "'" || c === '"') { scanString(c, blank || blankStrings); continue; }
      if (c === '`') { scanTemplate(blank); continue; }
      if (c === '{') { brace++; lastSig = '{'; lastWord = ''; lastWasIncDec = false; out += blank ? ' ' : c; i++; continue; }
      if (c === '}') { brace--; lastSig = '}'; lastWord = ''; lastWasIncDec = false; out += blank ? ' ' : c; i++; continue; }
      if (/[A-Za-z_$]/.test(c)) {
        const prop = lastSig === '.';   // member access -> a value, not a keyword
        let w = '';
        while (i < n && /[\w$]/.test(src[i])) { w += src[i]; out += blank ? ' ' : src[i]; i++; }
        lastWord = w; lastSig = w[w.length - 1]; lastWordIsProp = prop; lastWasIncDec = false;
        continue;
      }
      if (/\s/.test(c)) { out += c === '\n' ? '\n' : (blank ? ' ' : c); i++; continue; }
      // A `++` / `--` repeats the operator char; the second one forms a postfix
      // op when it followed a value (identifier / `)` / `]`), the only case that
      // matters for the regex-vs-division decision here.
      lastWasIncDec = (c === '+' || c === '-') && c === lastSig;
      lastSig = c; lastWord = ''; out += blank ? ' ' : c; i++;
    }
  }

  scanCode(false, false);
  return { out, literals };
}

/**
 * Blank ONLY comments, keeping string AND template-literal content verbatim
 * (position-preserving: same length, newlines kept). The sibling
 * `redactStringsAndTemplates` blanks templates too, which is wrong for callers
 * that need to read inside `html` templates (the elision render-tag scanner) or
 * inside string arguments (`whenDefined('tag')`). This keeps both and removes
 * only comment text, so prose in a comment cannot be read as a real signal
 * (issue #179). It reuses the same regex-versus-division and tagged-template
 * disambiguation so a `//` inside a string/template/regex is never mistaken for
 * a comment.
 *
 * @param {string} src
 * @returns {string} src with comment bodies blanked, everything else verbatim
 */
export function maskComments(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  let lastSig = '';
  let lastWord = '';
  let lastWordIsProp = false;
  let lastWasIncDec = false;
  const markValue = () => { lastSig = 'x'; lastWord = ''; lastWordIsProp = false; lastWasIncDec = false; };
  const isRegex = () => {
    if (lastSig === '') return true;
    if (lastSig === ')' || lastSig === ']') return false;
    if (lastSig === "'" || lastSig === '"' || lastSig === '`') return false;
    if (lastWasIncDec) return false;
    if (/[\w$]/.test(lastSig)) return !lastWordIsProp && REGEX_PRECEDING_KEYWORDS.has(lastWord);
    return true;
  };
  // Comments: blank the body (keep the `//` / `/* */` delimiters and newlines).
  const scanLineComment = () => { out += '//'; i += 2; while (i < n && src[i] !== '\n') { out += ' '; i++; } };
  const scanBlockComment = () => {
    out += '/*'; i += 2;
    while (i < n) {
      if (src[i] === '*' && src[i + 1] === '/') { out += '*/'; i += 2; return; }
      out += src[i] === '\n' ? '\n' : ' '; i++;
    }
  };
  // String / template / regex: copy verbatim, but lex correctly so a `//` or
  // `/*` inside them is not treated as a comment.
  const scanString = (q) => {
    out += q; i++;
    while (i < n) {
      if (src[i] === '\\' && i + 1 < n) { out += src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === q) { out += q; i++; break; }
      if (src[i] === '\n') { out += '\n'; i++; break; }
      out += src[i]; i++;
    }
    markValue();
  };
  const scanRegex = () => {
    out += '/'; i++;
    let inClass = false;
    while (i < n) {
      const d = src[i];
      if (d === '\\' && i + 1 < n) { out += d + src[i + 1]; i += 2; continue; }
      if (d === '\n') break;
      if (d === '[') inClass = true;
      else if (d === ']') inClass = false;
      else if (d === '/' && !inClass) { out += '/'; i++; break; }
      out += d; i++;
    }
    markValue();
  };
  const scanTemplate = () => {
    out += '`'; i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\' && i + 1 < n) { out += c + src[i + 1]; i += 2; continue; }
      if (c === '`') { out += '`'; i++; break; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; scanCode(true); if (i < n && src[i] === '}') { out += '}'; i++; } continue; }
      out += c; i++;
    }
    markValue();
  };
  function scanCode(stopHole) {
    let brace = 0;
    while (i < n) {
      const c = src[i], next = src[i + 1];
      if (stopHole && c === '}' && brace === 0) return;
      if (c === '/' && next === '/') { scanLineComment(); continue; }
      if (c === '/' && next === '*') { scanBlockComment(); continue; }
      if (c === '/' && isRegex()) { scanRegex(); continue; }
      if (c === "'" || c === '"') { scanString(c); continue; }
      if (c === '`') { scanTemplate(); continue; }
      if (c === '{') { brace++; lastSig = '{'; lastWord = ''; lastWasIncDec = false; out += c; i++; continue; }
      if (c === '}') { brace--; lastSig = '}'; lastWord = ''; lastWasIncDec = false; out += c; i++; continue; }
      if (/[A-Za-z_$]/.test(c)) {
        const prop = lastSig === '.';
        let w = '';
        while (i < n && /[\w$]/.test(src[i])) { w += src[i]; out += src[i]; i++; }
        lastWord = w; lastSig = w[w.length - 1]; lastWordIsProp = prop; lastWasIncDec = false;
        continue;
      }
      if (/\s/.test(c)) { out += c; i++; continue; }
      lastWasIncDec = (c === '+' || c === '-') && c === lastSig;
      lastSig = c; lastWord = ''; out += c; i++;
    }
  }
  scanCode(false);
  return out;
}

/**
 * Extract the body of every `class … extends WebComponent { … }` block.
 * Brace-counts to handle nested template literals, methods, and arrow
 * functions. String state is tracked so braces inside strings/templates
 * don't shift depth.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractWebComponentClassBodies(content) {
  const bodies = [];
  // The optional `(?:\s*<[^{}();]*?>)?` skips a TypeScript generic parameter
  // list on the class name (`class Grid<T> extends WebComponent`), so a generic
  // component is not missed (which would let elision wrongly strip an
  // interactive component, the unsafe direction). The exclusion class keeps the
  // generic from swallowing the class body / a call, and stops it staying
  // within the type-parameter list (#753, found differentially).
  const re = /class\s+\w+(?:\s*<[^{}();]*?>)?\s+extends\s+WebComponent/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let i = m.index + m[0].length;
    while (i < content.length && /\s/.test(content[i])) i++;
    if (i >= content.length) continue;
    
    let factoryArg = '';
    const factoryProps = new Set();
    if (content[i] === '(') {
      const closeParen = matchClosingParenthesis(content, i + 1);
      if (closeParen === -1) continue;
      factoryArg = content.slice(i + 1, closeParen);
      
      const objStart = factoryArg.indexOf('{');
      if (objStart !== -1) {
        const objEnd = matchClosingBrace(factoryArg, objStart + 1);
        if (objEnd !== -1) {
          const objContent = factoryArg.slice(objStart + 1, objEnd);
          parsePropsFromObjectLiteral(objContent, factoryProps);
        }
      }
      i = closeParen + 1;
      while (i < content.length && /\s/.test(content[i])) i++;
    }
    if (content[i] === '{') {
      const bodyStart = i + 1;
      const end = matchClosingBrace(content, bodyStart);
      if (end !== -1) {
        bodies.push({
          body: content.slice(bodyStart, end),
          factoryProps,
          factoryArg,
          // Offsets into `content`. Callers pass the position-preserving MASK,
          // so these index the RAW source identically, which is how a caller
          // that needs the body's real template text gets it without asking
          // this lexer to handle raw source (#1307).
          bodyStart,
          bodyEnd: end,
        });
      }
    }
  }
  return bodies;
}

/**
 * Extract properties from an object literal block.
 *
 * @param {string} obj
 * @param {Set<string>} names
 */
export function parsePropsFromObjectLiteral(obj, names) {
  let i = 0;
  while (i < obj.length) {
    while (i < obj.length && /[\s,]/.test(obj[i])) i++;
    if (i >= obj.length) break;
    let key = '';
    if (obj[i] === '"' || obj[i] === "'") {
      const quote = obj[i++];
      while (i < obj.length && obj[i] !== quote) { key += obj[i++]; }
      i++; // closing quote
    } else {
      while (i < obj.length && /[A-Za-z0-9_$]/.test(obj[i])) key += obj[i++];
    }
    while (i < obj.length && /\s/.test(obj[i])) i++;
    if (obj[i] !== ':') break;
    i++;
    while (i < obj.length && /\s/.test(obj[i])) i++;
    if (obj[i] === '{') {
      const valEnd = matchClosingBrace(obj, i + 1);
      if (valEnd === -1) break;
      i = valEnd + 1;
    } else {
      while (i < obj.length && obj[i] !== ',' && obj[i] !== '}') i++;
    }
    if (key) names.add(key);
  }
}

/**
 * Like {@link parsePropsFromObjectLiteral} but captures each entry's raw
 * VALUE text alongside its key, so a rule can inspect the declaration
 * (`prop<CommentFormatted[]>(Object)`) rather than just the name.
 *
 * The value is read with balanced depth across `()`, `{}`, `[]`, `<>`,
 * and string/template literals, so an entry is split only on a
 * TOP-LEVEL comma. That keeps a value's own commas intact, whether they
 * sit inside an options object (`prop(Object, { default: () => [] })`),
 * an array literal, or a nested generic (`prop<Map<string, number>>(…)`).
 * Angle-bracket depth is decremented only when already open, so a stray
 * `=>` arrow or `>=` does not unbalance a value with no generic.
 *
 * @param {string} obj object-literal body (no enclosing braces)
 * @returns {{ key: string, value: string }[]}
 */
export function parsePropEntries(obj) {
  /** @type {{ key: string, value: string }[]} */
  const entries = [];
  const n = obj.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(obj[i])) i++;
    if (i >= n) break;
    let key = '';
    if (obj[i] === '"' || obj[i] === "'") {
      const quote = obj[i++];
      while (i < n && obj[i] !== quote) { key += obj[i++]; }
      i++; // closing quote
    } else {
      while (i < n && /[A-Za-z0-9_$]/.test(obj[i])) key += obj[i++];
    }
    while (i < n && /\s/.test(obj[i])) i++;
    if (obj[i] !== ':') break;
    i++;
    while (i < n && /\s/.test(obj[i])) i++;
    let round = 0, curly = 0, square = 0, angle = 0;
    let value = '';
    while (i < n) {
      const c = obj[i];
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        value += c; i++;
        while (i < n && obj[i] !== quote) {
          if (obj[i] === '\\') { value += obj[i] + (obj[i + 1] || ''); i += 2; continue; }
          value += obj[i++];
        }
        if (i < n) value += obj[i++];
        continue;
      }
      if (c === ',' && round === 0 && curly === 0 && square === 0 && angle === 0) break;
      if (c === '}' && curly === 0) break; // end of the enclosing object literal
      if (c === '(') round++;
      else if (c === ')') { if (round > 0) round--; }
      else if (c === '{') curly++;
      else if (c === '}') curly--;
      else if (c === '[') square++;
      else if (c === ']') { if (square > 0) square--; }
      else if (c === '<') angle++;
      else if (c === '>') { if (angle > 0) angle--; }
      value += obj[i++];
    }
    if (key) entries.push({ key, value: value.trim() });
  }
  return entries;
}


/**
 * Walk forward from `start` (just after an opening `(`) and return the
 * index of the matching `)`. Tracks string/template-literal state so
 * `)` inside strings or templates does not decrement depth.
 * Returns -1 if no balanced parenthesis is found.
 *
 * @param {string} s
 * @param {number} start
 */
export function matchClosingParenthesis(s, start) {
  let depth = 1;
  let i = start;
  let str = ''; // '', "'", '"', or backtick
  while (i < s.length) {
    const c = s[i];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = '';
      else if (str === '`' && c === '$' && s[i + 1] === '{') {
        const closeBrace = matchClosingBrace(s, i + 2);
        if (closeBrace === -1) return -1;
        i = closeBrace + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') { // line comment
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') { // block comment
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}


/**
 * Walk forward from `start` (just after an opening `{`) and return the
 * index of the matching `}`. Tracks string/template-literal state so
 * `}` inside `'…'`, `"…"`, or backtick templates don't decrement depth.
 * Returns -1 if no balanced brace is found.
 *
 * A template hole is a CODE context nested inside a template, not a brace in
 * the enclosing block, so it gets its own frame on the stack: `${` pushes,
 * and the `}` that returns that frame to depth zero pops back into the
 * template rather than counting toward the block being matched. An earlier
 * version incremented the outer depth at `${` and then never decremented it
 * (the closing `}` arrived while still in template state), so depth could
 * never return to zero and a class body holding `` html`…${x}…` `` was
 * unmatchable. Every caller passed a masked source in which holes are already
 * blanked, so the bug was invisible until one passed raw source (#1307).
 *
 * @param {string} s
 * @param {number} start
 */
export function matchClosingBrace(s, start) {
  // Innermost first. `tpl` frames are template literals (no brace counting);
  // `!tpl` frames are code, each with its own depth.
  /** @type {Array<{ tpl: boolean, depth: number }>} */
  const stack = [{ tpl: false, depth: 1 }];
  let i = start;
  while (i < s.length) {
    const top = stack[stack.length - 1];
    const c = s[i];
    if (top.tpl) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && s[i + 1] === '{') { stack.push({ tpl: false, depth: 1 }); i += 2; continue; }
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        const d = s[i];
        i++;
        if (d === c || d === '\n') break;   // closed, or unterminated at EOL
      }
      continue;
    }
    if (c === '`') { stack.push({ tpl: true, depth: 0 }); i++; continue; }
    if (c === '/' && s[i + 1] === '/') { // line comment
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') { // block comment
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') { top.depth++; i++; continue; }
    if (c === '}') {
      top.depth--;
      // Depth zero closes this frame: the outermost one is the answer, an inner
      // one is a template hole ending and hands control back to its template.
      if (top.depth === 0) {
        if (stack.length === 1) return i;
        stack.pop();
      }
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Return `src` with the BODY of every comment replaced by spaces, and the
 * body of single-quoted, double-quoted, and template-literal segments
 * replaced by placeholders like `__STR_index__`. Quote delimiters and template
 * backticks are preserved so code structure is unchanged. Template holes
 * `${...}` are left intact (and scanned recursively as code).
 *
 * Returns `{ redacted: string, literals: string[] }` where `literals` holds
 * the original unquoted literal contents.
 *
 * @param {string} src
 * @returns {{ redacted: string, literals: string[] }}
 */
export function redactToPlaceholders(src) {
  const { out, literals } = scanLiterals(src, { placeholder: true });
  return { redacted: out, literals };
}

/**
 * The attribute position a template hole commits to, read from the literal
 * segment immediately before it. Returns the attribute NAME only; a caller
 * pairs it with the tag the hole sits in.
 *
 * @param {string} literalBefore
 * @returns {'action' | 'formaction' | null}
 */
function trailingActionAttr(literalBefore) {
  if (/\sformaction=$/i.test(literalBefore)) return 'formaction';
  if (/\saction=$/i.test(literalBefore)) return 'action';
  return null;
}

/**
 * Classify a template hole by the start tag and attribute it commits: `'form'`
 * for `<form action=` (#1155), `'submitter'` for `<button|input formaction=`
 * (#1207), and `null` for anything else.
 *
 * Reading the segment immediately before the hole rather than the whole
 * template is what keeps `<div action=${x}>` out. The tag and the attribute are
 * matched as a PAIR, so `<form formaction=${x}>` and `<button action=${x}>`
 * stay out too: both are refused at render time, and neither is a binding.
 *
 * @param {string} literalBefore the literal segment immediately before the hole
 * @returns {'form' | 'submitter' | null}
 */
export function classifyActionHole(literalBefore) {
  const attr = trailingActionAttr(literalBefore);
  if (!attr) return null;
  // The last `<` opens the tag the hole sits in. Requiring no `>` after it
  // keeps the match inside that one start tag.
  const tagAt = literalBefore.lastIndexOf('<');
  if (tagAt < 0) return null;
  const tag = literalBefore.slice(tagAt);
  if (tag.includes('>')) return null;
  if (attr === 'action' && /^<form\b/i.test(tag)) return 'form';
  if (attr === 'formaction' && /^<(?:button|input)\b/i.test(tag)) return 'submitter';
  return null;
}

/**
 * The ONE `enctype` keyword that loses a form body the server could otherwise
 * read.
 *
 * Stated as a denylist rather than an allowlist because `enctype` is an
 * enumerated attribute whose missing value default AND invalid value default are
 * both `application/x-www-form-urlencoded`. So `enctype="nonsense"` falls back to
 * urlencoded and submits a perfectly parseable body; only the third valid
 * keyword, `text/plain`, is a real loss. An allowlist inverts that and reports a
 * working form as broken, which this rule must never do.
 *
 * The renderer's `PARSEABLE_ENCTYPES` (`form-action.js`) refuses the wider set,
 * and that divergence is deliberate on BOTH sides rather than an inconsistency
 * to unify. The two ask different questions. This rule asks whether the
 * identity ARRIVES, and under an invalid enctype it does. The renderer asks
 * whether the form will do what the author wrote, and there an invalid value is
 * the dangerous case: `enctype="multipart/form-dat"` falls back to urlencoded,
 * which silently drops every FILE from the submission, so throwing at render is
 * the only way the author finds out. Unifying them would either make the
 * renderer accept a typo that loses uploads, or make this rule report a working
 * form as broken.
 */
const UNPARSEABLE_FORM_ENCTYPE = 'text/plain';

/**
 * Read one attribute's literal value out of a start tag's accumulated text.
 * Returns null when absent, and the raw value otherwise (quoted or bare).
 *
 * @param {string} tagText
 * @param {string} name
 * @returns {string | null}
 */
function startTagAttr(tagText, name) {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tagText);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/**
 * Would an UNBOUND `<form>` still deliver a submitter's action identity?
 *
 * This is the difference between a broken write path and a working one, and it
 * is not intuitive. A submitter carries its identity in its OWN `name`/`value`
 * pair, which a browser submits for the pressed button alone, so an unbound
 * form that still sends a parseable POST body delivers it and the action RUNS
 * (the dispatcher takes the last `__webjs_action` entry it finds). What breaks
 * is a form that sends no body the server can read: no `method` at all or
 * `method="get"` (a GET puts the identity in the query string and the page just
 * re-renders), or an enctype `parseFormBody` cannot parse (a 405).
 *
 * Both are enumerated attributes matched against exact keywords with no
 * whitespace stripping, and their defaults pull in OPPOSITE directions, which is
 * why they are tested differently. `method` defaults to GET, so anything that is
 * not exactly `post` loses the body (a padded `method=" post "` included).
 * `enctype` defaults to `application/x-www-form-urlencoded` for both a missing
 * AND an invalid value, so only the `text/plain` keyword actually loses it.
 *
 * @param {string} tagText the form's start tag, from `<form` to just before `>`
 * @returns {boolean}
 */
function unboundFormDelivers(tagText) {
  const method = startTagAttr(tagText, 'method');
  if (method === null || method.toLowerCase() !== 'post') return false;
  const enctype = startTagAttr(tagText, 'enctype');
  if (enctype !== null && enctype.toLowerCase() === UNPARSEABLE_FORM_ENCTYPE) return false;
  return true;
}

/**
 * The ONE start-tag hole the renderer renders INLINE, in the enclosing scan and
 * with the enclosing form scope, rather than handing to the receiving element:
 * `<webjs-suspense .fallback=${html`…`}>` (#471).
 *
 * A custom-element property applies only at HYDRATION, which is too late for a
 * placeholder that has to be in the first flushed bytes, so `render-server.js`
 * renders the fallback right there and carries the HTML as
 * `data-webjs-fallback`. (The timing is the operative reason on its own. A
 * serializable `TemplateResult` would otherwise ride as `data-webjs-prop-*`
 * perfectly well; only one carrying a function fails to serialize.) That means a submitter in a fallback IS judged against
 * the enclosing form, and the renderer really does throw for an unbound one.
 * Treating it as handed off would make the same-scan half blind to the one shape
 * it exists to pre-warn about.
 *
 * @param {string} tagName lowercased
 * @param {string} literalBefore the literal segment immediately before the hole
 * @returns {boolean}
 */
function isInlineStartTagHole(tagName, literalBefore) {
  // The property name is a JS identifier, so it is case-SENSITIVE, unlike an
  // attribute name.
  return tagName === 'webjs-suspense' && /\.fallback=$/.test(literalBefore);
}

/**
 * @typedef {'none'|'unbound'|'bound'|'handed'} FormScope
 *
 * `'none'` and `'handed'` are BOTH "no enclosing form in this scan", and they
 * are deliberately separate values because a caller must treat them
 * differently. `'none'` is a cannot-tell that the file's own component may
 * legitimately own, so a caller may attribute it and resolve it against that
 * component's call sites. `'handed'` is a template sitting in a start-tag hole,
 * which is an attribute or property VALUE: some OTHER element received it and
 * decides where it renders, so this file's call sites say nothing about it and
 * it can never be attributed to anything. Collapsing the two makes a handed-off
 * template resolve through the wrong component's call sites.
 *
 * @typedef {{
 *   tag: string,
 *   scope: FormScope,
 *   delivers: boolean | null,
 * }} FormScopeSite
 *
 * `delivers` is meaningful only when `scope` is `'unbound'`: true when that
 * form would still carry a submitter's identity to the server, false when it
 * would not, and null when a hole in its start tag makes the answer dynamic and
 * therefore unknowable.
 */

/**
 * Walk every `` html`...` `` template literal in `src` and report, for each
 * submitter action hole (`<button|input formaction=${...}>`) and each
 * custom-element start tag, the enclosing `<form>` scope at that point (#1307).
 *
 * Only an `html`-tagged literal is entered, so `const s = '<form>'` and a `css`
 * or `sql` template are never read as markup. That carve-out matters: the
 * framework's own website renders `<form action=${fn}>` as a code SAMPLE.
 *
 * A template nested inside a CHILD-position hole INHERITS the enclosing scope,
 * because that is what the renderer does (`render` threads `formScope` through
 * arrays, `repeat`, and nested templates).
 *
 * One in a START-TAG hole is `'handed'`: an attribute or property value whose
 * placement this scan cannot speak for. Worth being exact about why, because the
 * obvious reason is not the operative one. SSR does NOT render such a template
 * in place: a serializable value rides to the receiving element as
 * `data-webjs-prop-*` and is applied at HYDRATION, and one carrying a function
 * (a bound submitter, by definition) fails to serialize, so `render-server.js`
 * DROPS the binding with a warning and emits nothing for it at all. Either way
 * the element that receives the property decides where the content lands, in the
 * browser, which is exactly what this scan cannot see.
 *
 * The single exception is `<webjs-suspense .fallback=${…}>`, which the renderer
 * really does render inline with the enclosing scope (see
 * `isInlineStartTagHole`), so that one inherits.
 *
 * A separate top-level template starts fresh at
 * `'none'`, because it is its own scan there too. `</form>` returns to the scope
 * the scan started in, mirroring `handleTagEnd` in `render-server.js`.
 *
 * `opensForm` reports whether ANY `<form` start tag was seen anywhere in `src`.
 * A caller attributing a scope-`'none'` site to this file needs it: a fragment
 * built into a local and spliced into a form the same file opens inherits the
 * SPLICE point's scope, not the file's own call-site scope, so a file that
 * opens a form cannot have its `'none'` sites attributed safely.
 *
 * @param {string} src
 * @returns {{ submitters: FormScopeSite[], tagUses: FormScopeSite[], opensForm: boolean }}
 */
export function scanHtmlFormScopes(src) {
  const { redacted, literals } = redactToPlaceholders(src);
  /** @type {FormScopeSite[]} */
  const submitters = [];
  /** @type {FormScopeSite[]} */
  const tagUses = [];
  let opensForm = false;
  const n = redacted.length;
  // Sticky, so matching a literal placeholder at the cursor costs no slice.
  const STR = /__STR_(\d+)__/y;

  /**
   * Walk code. In placeholder mode a comment body and a regex body are already
   * blanked to spaces and a string body is one opaque token, so the only
   * structure left to track is braces, quote delimiters, and backticks.
   *
   * @param {number} i
   * @param {boolean} stopAtBrace return at the `}` closing the enclosing hole
   * @param {FormScope} scope inherited by any template found here
   * @param {boolean | null} delivers inherited alongside `scope`
   * @returns {number}
   */
  function walkCode(i, stopAtBrace, scope, delivers) {
    let brace = 0;
    while (i < n) {
      const c = redacted[i];
      if (stopAtBrace && c === '}' && brace === 0) return i;
      if (c === '{') { brace++; i++; continue; }
      if (c === '}') { brace--; i++; continue; }
      if (c === "'" || c === '"') {
        i++;
        while (i < n && redacted[i] !== c && redacted[i] !== '\n') i++;
        if (i < n) i++;
        continue;
      }
      if (c === '`') {
        const before = redacted.slice(Math.max(0, i - 32), i);
        const tagged = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
        i = walkTemplate(i + 1, !!tagged && tagged[1] === 'html', scope, delivers);
        continue;
      }
      i++;
    }
    return i;
  }

  /**
   * Walk one template literal from just after its opening backtick.
   *
   * @param {number} i
   * @param {boolean} isHtml whether its markup should be read
   * @param {FormScope} startScope
   * @param {boolean | null} startDelivers
   * @returns {number} the index just past the closing backtick
   */
  function walkTemplate(i, isHtml, startScope, startDelivers) {
    /** @type {FormScope} */
    let scope = startScope;
    /** @type {boolean | null} */
    let delivers = startDelivers;
    /**
     * The start tag currently open. It persists across literal segments AND
     * across holes, because `<form action=${fn} class="x">` is one tag split
     * into three pieces by the scan. `text` accumulates the tag's literal
     * source so its attributes can be read at the `>`, and `dynamicAttrs`
     * records that a hole other than the action binding landed in it, which
     * makes those attributes unknowable.
     * @type {null | { name: string, isClose: boolean, quote: string | null, formHole: boolean, submitterHole: boolean, text: string, dynamicAttrs: boolean }}
     */
    let tag = null;
    let inComment = false;
    let lastLiteral = '';

    const closeTag = () => {
      const t = tag;
      tag = null;
      if (!t) return;
      if (t.isClose) {
        // Back to the scope this scan STARTED in, not a flat 'none': a nested
        // template closing a form of its own learns nothing about the form its
        // caller may have opened.
        if (t.name === 'form') { scope = startScope; delivers = startDelivers; }
        return;
      }
      if (t.name === 'form') {
        opensForm = true;
        // A form that opened and bound NOTHING still opens a scope: a submitter
        // inside it is a different answer from one with no form at all. Whether
        // that unbound form would still DELIVER a submitter's identity is a
        // separate question, and the one that decides if the shape is broken.
        scope = t.formHole ? 'bound' : 'unbound';
        delivers = t.formHole ? null : (t.dynamicAttrs ? null : unboundFormDelivers(t.text));
        return;
      }
      if (t.submitterHole) submitters.push({ tag: t.name, scope, delivers });
      if (t.name.includes('-')) tagUses.push({ tag: t.name, scope, delivers });
    };

    /** @param {string} text one literal segment, read as markup */
    const consumeMarkup = (text) => {
      let p = 0;
      while (p < text.length) {
        if (inComment) {
          const end = text.indexOf('-->', p);
          if (end < 0) return;
          inComment = false;
          p = end + 3;
          continue;
        }
        if (tag) {
          const ch = text[p];
          if (tag.quote) {
            if (ch === tag.quote) tag.quote = null;
            tag.text += ch;
            p++;
            continue;
          }
          if (ch === '"' || ch === "'") { tag.quote = ch; tag.text += ch; p++; continue; }
          if (ch === '>') { p++; closeTag(); continue; }
          tag.text += ch;
          p++;
          continue;
        }
        const lt = text.indexOf('<', p);
        if (lt < 0) return;
        if (text.startsWith('<!--', lt)) { inComment = true; p = lt + 4; continue; }
        const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(text.slice(lt));
        if (!m) { p = lt + 1; continue; }
        tag = {
          name: m[2].toLowerCase(),
          isClose: m[1] === '/',
          quote: null,
          formHole: false,
          submitterHole: false,
          text: m[0],
          dynamicAttrs: false,
        };
        p = lt + m[0].length;
      }
    };

    while (i < n) {
      const c = redacted[i];
      if (c === '`') return i + 1;
      if (c === '$' && redacted[i + 1] === '{') {
        if (isHtml && tag && !tag.isClose) {
          const attr = trailingActionAttr(lastLiteral);
          if (attr === 'action' && tag.name === 'form') tag.formHole = true;
          else if (attr === 'formaction' && (tag.name === 'button' || tag.name === 'input')) tag.submitterHole = true;
          // Any OTHER hole in a form's start tag makes its `method` / `enctype`
          // dynamic, so whether an unbound form would deliver becomes unknowable.
          else if (tag.name === 'form') tag.dynamicAttrs = true;
        }
        // A hole inside a START TAG is USUALLY an attribute or property VALUE
        // whose placement this scan cannot speak for, so it starts at 'handed'
        // instead of inheriting. A hole in CHILD position is rendered inline by
        // this scan and does inherit, and so does the one start-tag hole the
        // renderer also renders inline (`isInlineStartTagHole`).
        //
        // Read the JSDoc on `scanHtmlFormScopes` for why 'handed' is right: SSR
        // does NOT render such a template in place, so the receiving element
        // decides where it lands, in the browser.
        //
        // Without the split, `<form method="post"><my-thing .tpl=${html`<button
        // formaction=${del}>x</button>`}></my-thing></form>` scored the button
        // 'unbound' from lexical nesting. Nothing renders that button at SSR at
        // all (the binding carries a function, so it fails to serialize and is
        // dropped), and where it ends up is `my-thing`'s decision at hydration,
        // so a conclusive verdict here was never this scan's to give.
        //
        // 'handed' and NOT 'none', which is the subtle half: 'none' is the
        // cannot-tell a caller attributes to this file's own component and
        // resolves against ITS call sites, and a handed-off template belongs to
        // whichever element received it instead. Using 'none' here silences the
        // false positive on a page and recreates it in a component file.
        const inlineHole = tag && !tag.isClose && isInlineStartTagHole(tag.name, lastLiteral);
        const handOff = tag && !tag.isClose && !inlineHole;
        const holeScope = handOff ? 'handed' : scope;
        const holeDelivers = handOff ? null : delivers;
        // Only the segment IMMEDIATELY before a hole can commit an attribute,
        // so two adjacent holes leave nothing for the second to read.
        lastLiteral = '';
        i = walkCode(i + 2, true, holeScope, holeDelivers);
        if (i < n && redacted[i] === '}') i++;
        continue;
      }
      STR.lastIndex = i;
      const m = STR.exec(redacted);
      if (m) {
        const text = literals[Number(m[1])] || '';
        lastLiteral = text;
        if (isHtml) consumeMarkup(text);
        i = STR.lastIndex;
        continue;
      }
      i++;
    }
    return i;
  }

  walkCode(0, false, 'none', null);
  return { submitters, tagUses, opensForm };
}

