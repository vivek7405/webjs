/**
 * Markdown body renderer for changelog entries.
 *
 * Pure function. Browser-safe (no node:fs). Tighter typography than
 * the blog post renderer because changelog cards stack multiple
 * entries per page (smaller text, less margin). Sibling
 * `modules/blog/utils/render-post.ts` is the long-form version.
 */

function inline(s: string): string {
  let out = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) =>
    `<a href="${u}" class="text-accent no-underline hover:underline" rel="noopener noreferrer">${t}</a>`);
  out = out.replace(/`([^`]+)`/g, '<code class="font-mono text-[12.5px] bg-fg/8 text-fg px-1 py-0.5 rounded">$1</code>');
  // **bold** non-greedy single-line: must allow asterisks inside the
  // span so titles like "**data-webjs-prop-* side-channel**" still
  // parse. The previous [^*]+ rejected the embedded asterisk and
  // silently left the literal ** in the rendered output.
  out = out.replace(/\*\*([^\n]+?)\*\*/g, '<strong class="font-semibold text-fg">$1</strong>');
  // _italic_ and *italic* (the backfill generator does not emit these,
  // but hand-curated entries can; the previous renderer left the
  // underscores in the rendered HTML).
  out = out.replace(/(^|[^\w])_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[^\w])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*[^*\s]|[^*\s])\*(?=$|[^*\w])/g, '$1<em>$2</em>');
  return out;
}

/**
 * One paragraph of an entry's body, as its soft-wrapped source lines plus the
 * indent depth it was opened at. Depth 1 is the entry's own level.
 */
type Para = { depth: number; lines: string[] };

/**
 * Depth a bullet's leading indent states. Two spaces per level, clamped at 3
 * because a release note has no legitimate fourth level and the clamp is what
 * stops a pathological source file emitting a runaway ladder.
 */
function depthOf(indent: number): number { return Math.min(Math.floor(indent / 2), 3); }

/**
 * Depth as a left inset, from a literal lookup. Tailwind v4 scans this tree
 * for complete literal class strings, so a computed `pl-${depth * 4}` would
 * generate no utility at all and the inset would silently do nothing while
 * every test asserting on the class name still passed.
 */
const INSET: Record<number, string> = { 1: '', 2: ' pl-4', 3: ' pl-8' };

/** Render the body of one changelog entry: h1 / h2 / bulleted lists / paragraphs. */
export function renderEntryBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  // An entry item is a sequence of PARAGRAPHS, not a flat run of lines. A
  // blank line inside an item is a paragraph BREAK within it (CommonMark
  // reads a 2-space-indented paragraph after a blank as list-item
  // continuation), so it closes the open paragraph rather than the item.
  // Closing the item there is what used to turn one multi-paragraph entry
  // into a stack of sibling bullets: 3 entries rendered as 23 peer items.
  //
  // An indented BULLET is a paragraph too, with its marker dropped. The
  // changelog is one bullet per released change, and a second level of
  // glyphs under half of them is noise: the generator writes each squashed
  // commit subject as its own `*` line, which restated the entry title above
  // it in 119 of the corpus's 378 indented bullets. So no entry body renders
  // a list, at any depth.
  //
  // Depth is still REPRESENTED, as a left inset on the paragraph and nothing
  // else (no marker, no type-size change, no rule), so a child point reads as
  // subordinate to its parent rather than as its parent's peer. The rule both
  // indented branches follow, stated once: only a bullet marker ESTABLISHES
  // depth, so an unmarked line can inherit or go shallower but never deeper.
  //
  // The corpus decided the inheriting half, and the numbers are worth stating
  // exactly, because the loose version of them ("37 lines, 10 files") reads
  // as much stronger evidence than it is. There are zero bullets at four or
  // more spaces across the 229 entry files, and 37 NON-bullet lines at four
  // or more, spread over 10 files. All 37 render with no inset, but by two
  // different mechanisms: 31 of them are soft wraps that join the paragraph
  // above through the depth-blind branch below, which reads no indent under
  // any implementation. Only 6 lines, in 4 files, actually reach the
  // fresh-paragraph branch, and letting THAT branch read its own indent
  // outright is what would re-render them. They are also not the wrapped
  // prose the shorthand suggests: they are indented code blocks (a component
  // class, an `export const metadata = {`) and one alignment table. Measured
  // by rendering the whole corpus both ways, not by reading the sources.
  //
  // The shallower half stops the opposite failure: closing prose written back
  // at the entry level after a deeper bullet must not stay dragged under that
  // bullet.
  let itemOpen = false;
  let paras: Para[] = [];
  let open: Para | null = null;

  // Returns the paragraph rather than assigning `open` itself. TypeScript's
  // control-flow analysis ignores a write made inside a nested function when
  // it narrows a `let` read in the enclosing scope, so an assigning version
  // leaves `open` narrowed to `null` at the read below and the truthiness
  // guard there narrows it to `never`. Assigning at each call site keeps the
  // write in the enclosing function's own control-flow graph.
  function startPara(text: string, depth: number): Para {
    const p: Para = { depth, lines: [text] };
    paras.push(p);
    return p;
  }

  function renderParas(ps: Para[]): string {
    // The overwhelmingly common entry is a single line with no body. Emit it
    // bare so its markup is unchanged by the multi-paragraph support. Only
    // the column-0 branch can open an item's first paragraph, so a lone
    // paragraph is always depth 1; the guard says so rather than assuming it.
    if (ps.length === 1 && ps[0].depth === 1) return inline(ps[0].lines.join(' '));
    return ps.map((p) =>
      `<p class="my-2 first:mt-0 last:mb-0${INSET[p.depth] ?? ''}">${inline(p.lines.join(' '))}</p>`).join('');
  }

  function flushItem() {
    if (itemOpen) {
      out.push(`<li class="text-fg-muted text-[14px] leading-relaxed">${renderParas(paras)}</li>`);
      itemOpen = false;
      paras = [];
      open = null;
    }
  }
  function endList() {
    flushItem();
    if (inList) { out.push('</ul>'); inList = false; }
  }
  function startList() {
    if (!inList) { out.push('<ul class="list-disc pl-5 space-y-2 my-3">'); inList = true; }
  }

  for (const raw of lines) {
    const line = raw;
    if (/^# /.test(line)) {
      endList();
      out.push(`<h3 class="font-mono text-[16px] font-semibold tracking-tight text-fg mt-0 mb-3">${inline(line.slice(2).trim())}</h3>`);
    } else if (/^## /.test(line)) {
      endList();
      out.push(`<h4 class="font-mono text-[11px] uppercase tracking-[0.15em] font-semibold text-fg-subtle mt-4 mb-1.5">${inline(line.slice(3).trim())}</h4>`);
    } else if (/^- /.test(line)) {
      // A top-level entry, recognised by its column-0 marker. Checking this
      // BEFORE the indented branches is what stops an open item swallowing
      // the entry that follows it.
      flushItem();
      startList();
      itemOpen = true;
      paras = [];
      open = startPara(line.slice(2).trim(), 1);
    } else if (itemOpen && /^ {2,}[-*] /.test(line)) {
      // Its own paragraph, marker dropped, at the depth its own indent
      // states. This is the branch that ESTABLISHES depth.
      const indent = (/^( +)/.exec(line)?.[1] ?? '').length;
      open = startPara(line.trim().slice(2).trim(), depthOf(indent));
    } else if (itemOpen && /^ {2,}\S/.test(line)) {
      const text = line.trim();
      // Soft-wrapped continuation of the open paragraph, which simply joins
      // it and reads no indent at all, or the start of a fresh one when a
      // blank line closed the last.
      //
      // A fresh one is capped at the depth of the paragraph BEFORE it, so it
      // inherits or goes shallower but never deeper. Note the ceiling is that
      // one paragraph, not the deepest level any bullet in the item reached:
      // once the item steps back out to the entry level, a later unmarked
      // line cannot climb back in, which is the conservative direction for a
      // signal as weak as leading whitespace. Both halves earn their keep,
      // and each has its own test. The cap keeps the 6 corpus lines that
      // reach this branch out of an inset; the shallower direction is what
      // stops closing prose written back at the entry level from being
      // dragged under the last deep bullet.
      if (open) open.lines.push(text);
      else {
        const last = paras.length ? paras[paras.length - 1].depth : 1;
        open = startPara(text, Math.min(depthOf((/^( +)/.exec(line)?.[1] ?? '').length), last));
      }
    } else if (line.trim() === '') {
      if (itemOpen) open = null;
      else flushItem();
    } else {
      endList();
      out.push(`<p class="text-fg-muted text-[14px] leading-relaxed my-3">${inline(line.trim())}</p>`);
    }
  }
  endList();
  return out.join('\n');
}
