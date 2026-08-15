#!/usr/bin/env node
/**
 * Design-quality scorer for a generated WebJs app (#1116).
 *
 * Takes an app directory and emits one number per rubric line. Every line is a
 * static scan of source text with NO model in the loop, so two runs over the
 * same input give the same number. That is the whole point: the harness is the
 * instrument the design gate is measured with, and an instrument whose reading
 * moves between runs cannot settle an argument about whether guidance helped.
 *
 * It emits NUMBERS, NEVER A JUDGMENT. A reviewer re-runs it against either side
 * of the gate and compares. Nothing here decides whether a screen looks good;
 * the lines count the specific tells that separate a hierarchy-flat screen from
 * one built against the tokens and primitives.
 *
 * Usage:
 *   node scripts/eval-design.mjs <app-dir> [--json]
 *
 * Exit code is 0 when every line is at target, 1 otherwise.
 *
 * The nine lines and why each is machine-checkable rather than a matter of
 * taste live beside their implementations below. The rubric is fixed: a line
 * added later changes what the gate measured, so both sides of a comparison
 * must be scored by the same commit of this file.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';

/** Directories scanned, relative to the app root. */
const SCAN_DIRS = ['app', 'components', 'modules', 'lib'];

/** Tailwind palette families a token-first app never names directly. */
const PALETTE_FAMILIES =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';

/** Utilities that can carry a palette colour. */
const COLOUR_UTILITIES = 'text|bg|border|ring|divide|outline|from|via|to';

/**
 * Metadata routes legitimately carry literal colour values: they render an
 * image or a manifest, neither of which can reference a CSS custom property.
 * The root layout is where the token block itself is declared, so it is the one
 * module whose whole job is to state literals.
 */
const LITERAL_COLOUR_EXEMPT =
  /^app[\\/](layout\.[jt]s|(opengraph-image|twitter-image|icon|apple-icon|manifest|global-error|global-not-found)\.[jt]s)$/;

/**
 * Blank out comment bodies, preserving every offset and newline.
 *
 * Scanning raw source counts a prose mention as a hit, and the first run of
 * this script proved it: an issue reference like `#1116` in a doc comment
 * matched the hex-colour pattern, so a file whose only sin was citing a ticket
 * scored as carrying a literal colour. Every rubric line reads the blanked text
 * for the same reason. A comment describing `bg-red-500` is discussing the
 * defect, not shipping it.
 *
 * Replacement is space-for-character so the hit positions stay true, which is
 * why this blanks rather than strips.
 *
 * @param {string} text
 * @returns {string}
 */
function blankComments(text) {
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const two = text.slice(i, i + 2);
    // A `//` preceded by `:` is a URL scheme, not a comment.
    if (two === '//' && text[i - 1] !== ':') {
      while (i < chars.length && chars[i] !== '\n') {
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? chars.length : end + 2;
      for (let j = i; j < stop; j += 1) if (chars[j] !== '\n') chars[j] = ' ';
      i = stop;
      continue;
    }
    if (two === '<!' && text.slice(i, i + 4) === '<!--') {
      const end = text.indexOf('-->', i + 4);
      const stop = end === -1 ? chars.length : end + 3;
      for (let j = i; j < stop; j += 1) if (chars[j] !== '\n') chars[j] = ' ';
      i = stop;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

/**
 * Collect every source file under the scanned directories.
 *
 * `text` is the comment-blanked source every rubric line scans; `raw` is the
 * original, kept so a hit's reported text can quote what is actually on the
 * line rather than the blanked version.
 *
 * @param {string} appDir
 * @returns {Array<{ path: string, rel: string, text: string, raw: string, lines: string[] }>}
 */
function collectFiles(appDir) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    const root = join(appDir, dir);
    if (!existsSync(root)) continue;
    walk(root);
  }
  return out;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const path = join(dir, entry);
      const st = statSync(path);
      if (st.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|js|mts|mjs)$/.test(entry)) continue;
      const raw = readFileSync(path, 'utf8');
      out.push({
        path,
        rel: relative(appDir, path).split(sep).join('/'),
        text: blankComments(raw),
        raw,
        lines: raw.split('\n'),
      });
    }
  }
}

/**
 * Record a hit with its source position.
 *
 * @param {{ rel: string, lines: string[] }} file
 * @param {number} index character offset into the file text
 * @param {string} text the matched text
 */
function hitAt(file, index, text) {
  let offset = 0;
  for (let i = 0; i < file.lines.length; i += 1) {
    const end = offset + file.lines[i].length + 1;
    if (index < end) return { file: file.rel, line: i + 1, text: text.trim().slice(0, 120) };
    offset = end;
  }
  return { file: file.rel, line: file.lines.length, text: text.trim().slice(0, 120) };
}

/**
 * Every match of a global regex, as hits.
 *
 * @param {ReturnType<typeof collectFiles>} files
 * @param {RegExp} re
 * @param {(file: { rel: string }) => boolean} [include]
 */
function scan(files, re, include) {
  const hits = [];
  for (const file of files) {
    if (include && !include(file)) continue;
    for (const m of file.text.matchAll(re)) hits.push(hitAt(file, m.index, m[0]));
  }
  return hits;
}

/** A page module is the file a route renders, which is where hierarchy lives. */
function isPageModule(file) {
  return /(^|\/)page\.[jt]s$/.test(file.rel);
}

/**
 * 1. raw-palette-utilities
 *
 * A token-first app never writes `bg-blue-600`. Naming a palette family is the
 * single clearest tell that the agent reached past the token layer, and it is
 * the one this issue's own registry tripped (`sonner.ts` shipped a raw
 * `text-emerald-500` because no `--success` token existed to use instead).
 */
function rawPaletteUtilities(files) {
  return scan(files, new RegExp(`\\b(${COLOUR_UTILITIES})-(${PALETTE_FAMILIES})-(50|[1-9]00|950)\\b`, 'g'));
}

/**
 * 2. literal-colour-values
 *
 * The same failure one level down: a hex or a colour function written into a
 * component instead of a token. Exempt where a literal is the only option.
 */
function literalColourValues(files) {
  // A hex only counts in a COLOUR POSITION: after a `:` (a CSS declaration or
  // an object property) or a `,` (a gradient stop). An issue reference reads
  // `(#492)` in prose, and blanking comments was not enough to stop it, since
  // the same reference appears in a metadata `description` string. Charging an
  // app for citing a ticket makes the whole line untrustworthy.
  return scan(
    files,
    /[:,]\s*#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|oklch)\(/g,
    (f) => !LITERAL_COLOUR_EXEMPT.test(f.rel),
  );
}

/**
 * 3. arbitrary-spacing
 *
 * A raw pixel length in a spacing or sizing utility means the agent translated
 * a number rather than using the scale. The scale is what makes spacing across
 * a screen consistent, so an app full of `p-[13px]` has no rhythm by
 * construction, whatever each individual value looks like.
 */
function arbitrarySpacing(files) {
  return scan(files, /\b(p|m|gap|space|w|h|size|inset|top|right|bottom|left)[a-z-]*-\[[0-9.]+(px|rem)\]/g);
}

/**
 * 4. type-scale-adherence
 *
 * Same argument for type. Every `text-` size must be a named step, so the count
 * here is of arbitrary sizes rather than of sizes in general.
 */
function typeScaleAdherence(files) {
  // `text-[color:...]` is a COLOUR, not a size, and Tailwind's own type hint
  // says so. Counting it charged an app for an arbitrary font size it never
  // set. `text-[length:...]` IS a size and stays counted.
  return scan(files, /\btext-\[(?!color:)/g);
}

/**
 * 5. heading-hierarchy
 *
 * Per page module: exactly one `<h1>`, and no skipped level in source order.
 * Emitted as the count of VIOLATING MODULES rather than of headings, because
 * one page with three `<h1>`s is one hierarchy failure, not three.
 */
function headingHierarchy(files) {
  const hits = [];
  for (const file of files) {
    if (!isPageModule(file)) continue;
    const levels = [...file.text.matchAll(/<h([1-6])\b/g)];
    if (levels.length === 0) continue;
    const h1s = levels.filter((m) => m[1] === '1');
    let problem = '';
    // MORE than one `<h1>` is provably wrong. ZERO is not: the heading may come
    // from a shared helper (`pageHeading()` returns an `<h1>`) or from the
    // layout, and a static scan of the page module cannot see either. Flagging
    // zero charged four correct pages in this repo's own gallery.
    if (h1s.length > 1) problem = `${h1s.length} <h1> elements, want exactly 1`;
    if (!problem) {
      let previous = 0;
      for (const m of levels) {
        const level = Number(m[1]);
        // Only compare levels present in THIS module, and skip the leading gap
        // for the same reason: an `<h2>` first is normal when the `<h1>` came
        // from a helper or a layout.
        if (previous && level > previous + 1) {
          problem = `<h${previous}> followed by <h${level}>, skipping a level`;
          break;
        }
        previous = level;
      }
    }
    if (problem) hits.push(hitAt(file, levels[0].index, problem));
  }
  return hits;
}

/**
 * 6. semantic-elevation
 *
 * Every shadow is a role (`shadow-e1` through `shadow-e4`) or none. A raw size
 * step means elevation was picked by how it looked at the call site rather than
 * by what the element is, which is exactly how a z-axis stops meaning anything.
 */
function semanticElevation(files) {
  return scan(files, /\bshadow-(2xs|xs|sm|md|lg|xl|2xl|inner)\b/g);
}

/**
 * 7. empty-state-present
 *
 * For each page module rendering a list, whether a sibling branch renders an
 * empty state. A blank region where data has not arrived is the single most
 * common generated-app defect, and it is invisible in a screenshot of seeded
 * data, which is why it is scored from source instead.
 */
function emptyStatePresent(files) {
  const hits = [];
  for (const file of files) {
    if (!isPageModule(file)) continue;
    // A list over a LITERAL array cannot be empty at runtime, so it needs no
    // empty branch. A fixed set of six notification checkboxes is the shape
    // this excludes, and counting it would train an author to add an empty
    // state that can never render, which is worse than the rule being silent.
    // The line's own definition is a list "over a query result", so a literal
    // was always out of scope; the first implementation just could not tell.
    const list = [...file.text.matchAll(/\.map\(|\brepeat\(/g)].find((m) => {
      const before = file.text.slice(0, m.index).trimEnd();
      // A SCREAMING_SNAKE receiver is a module constant by convention, so the
      // list is a fixed table (six notification toggles, a set of tabs) rather
      // than a query result, and it cannot be empty at runtime. Same reason as
      // the inline-literal case below, one indirection further out.
      if (/\b[A-Z][A-Z0-9_]{2,}$/.test(before)) return false;
      // Walk back over a balanced literal array immediately preceding `.map(`.
      if (!before.endsWith(']')) return true;
      let depth = 0;
      for (let i = before.length - 1; i >= 0; i -= 1) {
        if (before[i] === ']') depth += 1;
        else if (before[i] === '[') {
          depth -= 1;
          if (depth === 0) {
            // A literal opens with `[` preceded by an operator or a bracket,
            // never by an identifier or a closing paren (which would make it a
            // subscript on an expression rather than an array literal).
            const prev = before.slice(0, i).trimEnd().slice(-1);
            return !(prev === '' || '=(,:{&|?'.includes(prev));
          }
        }
      }
      return true;
    });
    if (!list) continue;
    if (/\bemptyStateClass\(/.test(file.text)) continue;
    hits.push(hitAt(file, list.index, 'renders a list with no empty branch'));
  }
  return hits;
}

/**
 * 8. action-pyramid
 *
 * At most one default-variant button per page module. More than one means
 * nothing is primary, which is the flat-hierarchy failure stated in the
 * language of the component API rather than of taste.
 */
function actionPyramid(files) {
  const hits = [];
  for (const file of files) {
    if (!isPageModule(file)) continue;
    const calls = [...file.text.matchAll(/\bbuttonClass\(([^)]*)\)/g)];
    const defaults = calls.filter((m) => {
      const args = m[1].trim();
      if (args === '') return true;
      return /variant:\s*['"`]default['"`]/.test(args);
    });
    if (defaults.length > 1) {
      hits.push(hitAt(file, defaults[1].index, `${defaults.length} default-variant buttons in one page`));
    }
  }
  return hits;
}

/**
 * 9. label-value-antipattern
 *
 * `Label: ${value}` inside a template. The pattern prints a field name at the
 * same weight as its value, which is the generated-app tell this issue's
 * Problem section names, and the reason `description-list.ts` exists.
 *
 * Attribute positions are excluded: `class="${x}"` and `aria-label="Total: ${n}"`
 * are not text nodes, so they are not this defect.
 */
function labelValueAntipattern(files) {
  const hits = [];
  for (const file of files) {
    // Scan only inside `html` template literals. The line's own definition is
    // "text nodes inside an html template", and scanning the whole file
    // charged a robots.txt line (`Sitemap: ${url}`) and a cache key
    // (`hint:${key}`) as screen output.
    for (const region of htmlTemplates(file.text)) {
      for (const m of region.text.matchAll(/[A-Za-z][A-Za-z ]*:\s*\$\{/g)) {
        const before = region.text.slice(0, m.index);
        // Inside a tag means this is an attribute value, not a text node.
        // Compare the last `<` against the last `>` that actually CLOSES a
        // tag: an arrow function in an event binding puts a `>` inside the
        // tag, and counting it made every attribute after an `@click=${() =>
        // ...}` look like a text node.
        const lastOpen = before.lastIndexOf('<');
        const lastClose = lastTagClose(before);
        if (lastOpen > lastClose) continue;
        hits.push(hitAt(file, region.start + m.index, m[0]));
      }
    }
  }
  return hits;
}

/**
 * The `html` tagged-template regions of a file, as {start, text} pairs.
 *
 * Nesting is handled by tracking backtick depth, so an inner html`` inside a
 * hole stays part of the outer region rather than truncating it.
 */
function htmlTemplates(text) {
  const out = [];
  const re = /\bhtml`/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    let i = start;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') depth += text.slice(0, i).endsWith('${') ? 1 : 0;
      if (c === '`' && depth === 1) break;
      if (c === '`') depth -= 1;
      i += 1;
    }
    out.push({ start, text: text.slice(start, i) });
    re.lastIndex = i;
  }
  return out;
}

/**
 * Index of the last `>` that closes a TAG, ignoring one inside an arrow
 * function, a comparison, or an entity.
 */
function lastTagClose(before) {
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (before[i] !== '>') continue;
    if (before[i - 1] === '=') continue; // `=>`
    return i;
  }
  return -1;
}

/** The rubric, in order. Each line targets zero. */
const RUBRIC = [
  { name: 'raw-palette-utilities', fn: rawPaletteUtilities },
  { name: 'literal-colour-values', fn: literalColourValues },
  { name: 'arbitrary-spacing', fn: arbitrarySpacing },
  { name: 'type-scale-adherence', fn: typeScaleAdherence },
  { name: 'heading-hierarchy', fn: headingHierarchy },
  { name: 'semantic-elevation', fn: semanticElevation },
  { name: 'empty-state-present', fn: emptyStatePresent },
  { name: 'action-pyramid', fn: actionPyramid },
  { name: 'label-value-antipattern', fn: labelValueAntipattern },
];

/**
 * Score an app directory.
 *
 * @param {string} appDir
 * @returns {{ appDir: string, lines: Array<{ name: string, count: number, target: number, pass: boolean, hits: Array<{ file: string, line: number, text: string }> }>, pass: boolean }}
 */
export function evaluate(appDir) {
  const files = collectFiles(appDir);
  const lines = RUBRIC.map(({ name, fn }) => {
    const hits = fn(files);
    return { name, count: hits.length, target: 0, pass: hits.length === 0, hits };
  });
  return { appDir, lines, pass: lines.every((l) => l.pass) };
}

/** The rubric line names, so a test can assert the set without importing the table. */
export const RUBRIC_LINES = RUBRIC.map((r) => r.name);

function main(argv) {
  const args = argv.filter((a) => a !== '--json');
  const json = argv.includes('--json');
  const appDir = args[0];

  if (!appDir) {
    console.error('usage: node scripts/eval-design.mjs <app-dir> [--json]');
    return 2;
  }
  if (!existsSync(appDir)) {
    console.error(`eval-design: no such directory: ${appDir}`);
    return 2;
  }

  const result = evaluate(appDir);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result.pass ? 0 : 1;
  }

  const width = Math.max(...RUBRIC_LINES.map((n) => n.length));
  console.log(`design rubric: ${basename(appDir)}`);
  for (const line of result.lines) {
    console.log(
      `  ${line.name.padEnd(width)}  ${String(line.count).padStart(4)}  target ${line.target}  ${line.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  const failed = result.lines.filter((l) => !l.pass);
  console.log(`  ${'total'.padEnd(width)}  ${String(result.lines.reduce((n, l) => n + l.count, 0)).padStart(4)}`);
  if (failed.length) {
    console.log('');
    for (const line of failed) {
      for (const hit of line.hits.slice(0, 10)) {
        console.log(`  ${line.name}  ${hit.file}:${hit.line}  ${hit.text}`);
      }
      if (line.hits.length > 10) console.log(`  ${line.name}  ... and ${line.hits.length - 10} more`);
    }
  }
  return result.pass ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
