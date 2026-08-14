/**
 * HTML string scanning primitives shared by the SSR passes.
 *
 * Everything here is a pure function of its arguments: no component registry,
 * no renderer, no DOM. That is what keeps this module a leaf, which is what
 * lets `template-renderer.js` take `isRawtextTag` from here instead of from
 * `dsd.js`, which is what breaks the render-server import cycle.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** @param {string} tag @returns {boolean} */
export function isVoidElement(tag) {
  return VOID_ELEMENTS.has(tag.toLowerCase());
}

/**
 * Index just past the end of the comment starting at `start`, or -1 if it is
 * unterminated. Shared so every scanner that has to decide where a comment
 * stops agrees, including on the spec short forms.
 *
 * @param {string} html
 * @param {number} start  index of the `<` of `<!--`
 * @returns {number}
 */
export function endOfComment(html, start) {
  let p = start + 4;
  // `<!-->` and `<!--->` are comments whose data is empty (spec short forms).
  if (html[p] === '>') return p + 1;
  if (html.startsWith('->', p)) return p + 2;
  while (p < html.length) {
    // `--!>` is the spec's "abrupt closing" form and closes just like `-->`.
    if (html.startsWith('-->', p)) return p + 3;
    if (html.startsWith('--!>', p)) return p + 4;
    p += 1;
  }
  return -1;
}

/**
 * Index of the `</script` that really closes a `<script>` whose content starts
 * at `from`, or -1 when unterminated (#1134).
 *
 * Script data is not plain raw text: once the content contains `<!--` followed
 * by `<script`, the tokenizer is in the script-data-double-escaped state, where
 * a `</script>` is TEXT (it only steps back to the escaped state) and the
 * element ends at the NEXT `</script>`. The legacy comment-wrapped inline
 * script that document.writes a script tag is the pattern that produces this.
 * Stopping at the first `</script>` there re-opened the original #1128 bug in
 * the one element the scanner most explicitly claims to handle.
 *
 * @param {string} html
 * @param {number} from  index just past the opening tag's `>`
 * @returns {number}
 */
export function endOfScriptContent(html, from) {
  const re = /<!--|-->|<\/script(?=[\s/>])|<script(?=[\s/>])/gi;
  re.lastIndex = from;
  let escaped = false;
  let dbl = false;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = m[0];
    if (t === '<!--') {
      // The token's own trailing `--` puts the tokenizer in a dash-dash state
      // REGARDLESS of what state it was in (`<!` are inert bytes in escaped and
      // double-escaped states too), and every dash-dash state exits straight
      // back to plain script data on `>`. So `<!-->`, `<!--->`, and any dash
      // run followed by `>` clear BOTH flags: entering fresh it cancels the
      // escape before it starts, and inside an escaped or double-escaped body
      // it is the exit a browser honours, after which the element ends at the
      // next `</script>`.
      let q = m.index + 4;
      while (html[q] === '-') q += 1;
      if (html[q] === '>') { escaped = false; dbl = false; re.lastIndex = q + 1; }
      else if (!escaped) escaped = true;
    }
    else if (t === '-->') { escaped = false; dbl = false; }
    else if (t[1] === '/') {
      if (dbl) dbl = false;
      else return m.index;
    } else if (escaped) dbl = true;
  }
  return -1;
}

/**
 * Byte ranges of `html` where a tag-shaped match is NOT an element (#1128).
 *
 * The element scanners below match tags with a flat regex over already-
 * assembled markup, which has no notion of an HTML context. So a registered tag
 * name written inside a comment used to be constructed and rendered as a real
 * element, and the replacement consumed the rest of the comment INCLUDING its
 * closing `-->`, leaving an unterminated comment that swallowed every following
 * byte. Whether it happened depended on whether the name in the comment was a
 * registered component, which is what made it look random.
 *
 * This is a single left-to-right pass rather than a search for `<!--`, because
 * the naive version introduces failures worse than the bug: an `<!--` inside an
 * attribute value (`title="use <!-- here"`) or inside RCDATA would open a region
 * that never closes, and every component after it would silently stop rendering.
 * Deciding that requires knowing the context, which means tokenizing, so the
 * pass tracks the same states the HTML parser does for these purposes:
 *
 * - **Comments**, including the spec's short forms. `<!-->` and `<!--->` close
 *   immediately, `--!>` closes as well as `-->`, and an unterminated comment
 *   runs to EOF, exactly as a browser would treat the same bytes.
 * - **Markup declarations and bogus comments** (`<!doctype …>`, `<![CDATA[…]]>`),
 *   which end at the next `>`.
 * - **Tags**, consumed with their quoted attribute values, so `<` and `<!--`
 *   inside an attribute are inert rather than context-changing.
 * - **Text-only elements**, whose content the HTML tokenizer never reads as
 *   markup: raw text (`script`, `style`, `iframe`, `xmp`, `noembed`,
 *   `noframes`, `plaintext`) and RCDATA (`textarea`, `title`). Their content is
 *   returned as a skip range too, because a component tag inside a `<style>`
 *   comment or an `<iframe>` fallback hit the identical markup-destroying path,
 *   so excluding them would leave half the bug live.
 *
 *   Two deliberate exclusions. `<template>` content IS parsed and legitimately
 *   carries components (Declarative Shadow DOM and the streamed swap templates
 *   both depend on that). `<noscript>` content is parsed as markup when
 *   scripting is disabled, which for a progressive-enhancement framework is the
 *   case that matters, so components inside it must keep rendering.
 *
 * @param {string} html
 * @returns {[number, number][]} ascending, non-overlapping `[start, end)` pairs
 */
export function inertRanges(html) {
  /** @type {[number, number][]} */
  const ranges = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = endOfComment(html, lt);
      const stop = end === -1 ? n : end;
      ranges.push([lt, stop]);
      i = stop;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      // Doctype / bogus comment / processing instruction: ends at the next `>`.
      const close = html.indexOf('>', lt);
      const end = close === -1 ? n : close + 1;
      ranges.push([lt, end]);
      i = end;
      continue;
    }
    const name = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (!name) {
      // `</` followed by anything that is not an ASCII letter is the third
      // bogus-comment form (`</1`, `</<`, `</ `), which the spec also runs to
      // the next `>`. Without this branch the bytes after it are scanned as
      // markup and a tag inside gets instantiated, which is the original bug.
      if (html.startsWith('</', lt)) {
        const close = html.indexOf('>', lt);
        const end = close === -1 ? n : close + 1;
        ranges.push([lt, end]);
        i = end;
        continue;
      }
      i = lt + 1;
      continue;
    }
    // Consume the tag, honouring quoted attribute values so a `<` or `<!--`
    // inside one cannot be mistaken for markup.
    //
    // A quote only OPENS a value when it directly follows `=`. That condition
    // is load-bearing rather than pedantic: `escapeAttr` does not escape `'`,
    // so an interpolated apostrophe in a single-quoted attribute emits three
    // unbalanced quotes (`title='don't'`). Treating every quote as a delimiter
    // left the scanner stuck inside a value to EOF, which returned a truncated
    // range list and silently re-enabled this whole bug for the rest of the
    // page. A browser recovers at the `>`, and so does this: after the value
    // closes, the stray `'` is just an attribute-name character.
    let p = lt + 1;
    let quote = '';
    // `expectValue` is set by `=` and cleared by the first non-whitespace
    // character after it. Only THAT character can open a quoted value, which is
    // what the spec does: before-attribute-value reconsumes anything else in
    // attribute-value-unquoted state. Keying off "the previous character was
    // `=`" instead re-opens the hole on `<a title==">`, where the `"` is an
    // ordinary value character; an odd quote count then ran the scan to EOF and
    // returned one giant inert range, silently disabling this whole fix for the
    // rest of the page.
    let expectValue = false;
    // Unquoted values need their own state for two reasons the spec spells out
    // and a simpler scan gets wrong: `>` ends the tag from here (so `attr=>` is
    // a missing value, not a value of `>`), and `/` is an ordinary value
    // character, so an unquoted URL ending in `/` is NOT a self-closing solidus.
    let inUnquoted = false;
    let selfClosing = false;
    while (p < n) {
      const c = html[p];
      const isSpace = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '>') {
        // Checked before the value branches: a `>` arriving where a value was
        // expected terminates the tag (`<a href=>`). Consuming it as a value
        // character ran the scan on to the NEXT `>`, which swallowed the real
        // tag end and re-armed the original bug for what followed.
        selfClosing = !inUnquoted && html[p - 1] === '/';
        p += 1;
        break;
      } else if (expectValue) {
        // The first non-whitespace character after `=` decides the value form.
        if (!isSpace) {
          if (c === '"' || c === "'") quote = c;
          else inUnquoted = true;
          expectValue = false;
        }
      } else if (inUnquoted) {
        if (isSpace) inUnquoted = false;
      } else if (c === '=') {
        expectValue = true;
      }
      p += 1;
    }
    // The tag's interior is not markup either. A component tag written inside
    // an attribute value (`title="renders a <my-card> element"`) was otherwise
    // instantiated in place, destroying the rest of the document exactly like
    // the comment case. Start at lt+1 so the tag's OWN opening `<` still
    // matches; only what is nested inside it is inert.
    if (p > lt + 1) ranges.push([lt + 1, p]);
    i = p;
    const tag = name[1].toLowerCase();
    const isClose = html[lt + 1] === '/';
    // A self-closing start tag has no content to skip. In HTML the `/` is
    // ignored, but in SVG and MathML foreign content it genuinely closes the
    // element, and `<svg><title/></svg>` otherwise finds no `</title`, runs the
    // range to EOF, and makes every component in the rest of the document
    // inert. Honouring `/>` costs only the malformed-HTML case (`<style/>`,
    // already broken authoring) and fails in the direction where components
    // keep rendering rather than silently vanishing.
    if (!isClose && !selfClosing && isTextOnlyTag(tag)) {
      // Everything up to the matching close tag is text, not markup.
      let contentEnd;
      if (tag === 'plaintext') {
        // `<plaintext>` has no end tag at all: the rest of the document is text.
        contentEnd = n;
      } else if (tag === 'script') {
        // Script data has the double-escaped state (#1134), so its real end is
        // not necessarily the first `</script`.
        const end = endOfScriptContent(html, p);
        contentEnd = end === -1 ? n : end;
      } else {
        const close = new RegExp(`</${tag}(?=[\\s/>])`, 'i').exec(html.slice(p));
        contentEnd = close ? p + close.index : n;
      }
      if (contentEnd > p) ranges.push([p, contentEnd]);
      i = contentEnd;
    }
  }
  return ranges;
}

/**
 * Random-access membership test over ascending, non-overlapping ranges, for
 * callers whose queries are NOT monotonic (findClosingTagInString resets its
 * regex cursors backward while pairing opens with closes). O(ranges) per call;
 * monotonic callers use `inertAt` below instead.
 *
 * @param {[number, number][]} ranges
 * @param {number} index
 * @returns {boolean}
 */
export function inRanges(ranges, index) {
  for (const [start, end] of ranges) {
    if (start > index) return false;
    if (index < end) return true;
  }
  return false;
}

/**
 * A left-to-right membership test over ascending, non-overlapping ranges.
 *
 * Returns a function that answers "is this index inert?" and REMEMBERS how far
 * it has walked, so a caller scanning matches in increasing order pays O(ranges)
 * across the whole scan instead of O(ranges) per match. Restarting each time is
 * an O(tags x components) term, which is measurable on a large page: holding a
 * document at 40k tags and raising the component count adds hundreds of
 * milliseconds that the cursor removes.
 *
 * The cursor only ever moves forward, so callers MUST query in non-decreasing
 * index order. All three call sites do (`matchAll`, and the two loops that
 * consume their input left to right). A caller that needs random access should
 * scan `ranges` directly rather than reusing this.
 *
 * @param {[number, number][]} ranges
 * @returns {(index: number) => boolean}
 */
export function inertAt(ranges) {
  let cursor = 0;
  return (index) => {
    while (cursor < ranges.length && ranges[cursor][1] <= index) cursor += 1;
    if (cursor >= ranges.length) return false;
    return index >= ranges[cursor][0];
  };
}

/**
 * Find the position of the matching closing tag for `tagName` starting from
 * `fromIndex` in `html`. Handles nested same-tag elements via depth tracking.
 * Returns the index of the `<` of `</tagName>`, or -1 if unclosed.
 *
 * @param {string} html
 * @param {number} fromIndex
 * @param {string} tagName
 * @returns {number}
 */
export function findClosingTagInString(html, fromIndex, tagName, inert) {
  const esc = escapeRegex(tagName);
  // Match same-name opening tags. Followed by a name-boundary character
  // so we don't accept <table> as opening <tab>.
  const openRe = new RegExp(`<${esc}(?:[\\s>/])`, 'gi');
  const closeRe = new RegExp(`</${esc}\\s*>`, 'gi');
  // A tag inside a comment, raw text, RCDATA, or an attribute value is text
  // and must count for NEITHER side of the depth ledger (#1133). Counting a
  // commented `<my-card>` as a nested open meant depth never returned to zero,
  // and matching a commented `</my-card>` as the close truncated the authored
  // children at the comment, so the projected content ended with an
  // unterminated `<!--` that a browser read as commenting out the real close
  // tags. Callers that already computed the ranges for this exact string pass
  // them; a caller that did not gets them computed here.
  const ranges = inert === undefined ? inertRanges(html) : inert;
  const next = (re) => {
    let m;
    while ((m = re.exec(html)) !== null) {
      if (ranges.length === 0 || !inRanges(ranges, m.index)) return m;
    }
    return null;
  };
  openRe.lastIndex = fromIndex;
  closeRe.lastIndex = fromIndex;
  let depth = 1;
  while (depth > 0) {
    const o = next(openRe);
    const c = next(closeRe);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      closeRe.lastIndex = o.index + 1;
    } else {
      depth--;
      if (depth === 0) return c.index;
      openRe.lastIndex = c.index + 1;
    }
  }
  return -1;
}

/** @param {string} s */
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} tag */
export function isRawtextTag(tag) {
  return tag === 'script' || tag === 'style';
}

/**
 * RCDATA elements: their content is text (character references aside), so a
 * tag-shaped string inside one is not markup. Kept next to `isRawtextTag` so
 * the two lists stay together rather than drifting apart.
 * @param {string} tag
 * @returns {boolean}
 */
export function isRcdataTag(tag) {
  return tag === 'textarea' || tag === 'title';
}

/**
 * Elements whose content the HTML tokenizer never reads as markup, for the
 * purposes of `inertRanges` only (#1128).
 *
 * Deliberately NOT `isRawtextTag`, even though it overlaps: that predicate is
 * shared with the template tokenizer, where widening it would change how holes
 * inside those elements are escaped. This one answers a narrower question,
 * "can a tag-shaped string in here be a real element", and the answer is no for
 * every raw-text and RCDATA element, not just the two the template path cares
 * about. `<iframe>` with fallback markup is the realistic trigger.
 *
 * `<noscript>` is excluded on purpose: its content IS parsed as markup when
 * scripting is disabled, which for a progressive-enhancement framework is the
 * case that matters, so components inside it must keep rendering.
 *
 * @param {string} tag
 * @returns {boolean}
 */
export function isTextOnlyTag(tag) {
  return isRawtextTag(tag) || isRcdataTag(tag)
    || tag === 'iframe' || tag === 'xmp' || tag === 'noembed'
    || tag === 'noframes' || tag === 'plaintext';
}
