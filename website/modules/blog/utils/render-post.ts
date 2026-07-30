/**
 * Markdown body renderer for blog posts.
 *
 * Pure function. Browser-safe (no node:fs). Imported by
 * `app/blog/[slug]/page.ts`. Knows the blog-specific typography
 * scale (17px paragraphs at 1.8 leading, mt-[80px] h2 headings, etc.)
 * but the regex parsing is local to this file. Sibling `/changelog`
 * has its own renderer with tighter typography.
 *
 * Supports:
 *   - `# ` h1 (rendered as h2 in output; the page provides the real h1)
 *   - `## ` h2 (rendered as h3)
 *   - `### ` h3 (rendered as h4)
 *   - `> ` blockquotes
 *   - `- ` bulleted lists (custom-positioned markers via `before:` pseudo-element)
 *   - ```fenced``` code blocks
 *   - Inline: **bold**, *italic*, `code`, [text](url). The URL may contain
 *     one level of balanced parens (e.g. a Wikipedia `..._(language)` link).
 *     An absolute or protocol-relative URL opens in a new tab (with a
 *     screen-reader cue); an internal `/path` link navigates in place.
 */

import { highlightToHtml } from '#lib/utils/highlight.ts';

function inline(s: string): string {
  let out = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // The URL group allows one level of balanced nested parens, so a link whose
  // address contains a `(...)` (e.g. a Wikipedia `..._(programming_language)`
  // URL) is captured whole instead of truncated at the first `)`.
  out = out.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_m, t, u) => {
    // Absolute (off-site) links open in a new tab so the reader keeps the
    // article; internal links (starting with /) navigate in place. Escape any
    // `"` in the URL so it cannot break out of the href attribute.
    const href = u.replace(/"/g, '%22');
    // External = an absolute http(s) URL (scheme is case-insensitive) or a
    // protocol-relative `//host`. Internal `/path` links stay same-tab.
    const external = /^(https?:)?\/\//i.test(u);
    // For a new-tab link, append the same visually-hidden cue the site chrome
    // uses (lib/links.ts NEW_TAB) so screen readers announce the tab change.
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const cue = external ? '<span class="sr-only"> (opens in a new tab)</span>' : '';
    return `<a href="${href}" class="text-accent no-underline hover:underline"${attrs}>${t}${cue}</a>`;
  });
  out = out.replace(/`([^`]+)`/g, '<code class="font-mono text-[0.9em] bg-bg-subtle text-fg px-[6px] py-[2px] rounded">$1</code>');
  out = out.replace(/\*\*([^\n]+?)\*\*/g, '<strong class="font-semibold text-fg">$1</strong>');
  out = out.replace(/(^|[^\w])_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[^\w])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*[^*\s]|[^*\s])\*(?=$|[^*\w])/g, '$1<em>$2</em>');
  return out;
}

export function renderPostBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let curItem: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = '';

  function flushItem() {
    if (curItem.length) {
      out.push(`<li class="text-fg-muted dark:text-fg text-[17px] leading-[1.8] relative pl-[28px] my-[12px] before:content-['•'] before:absolute before:left-[6px] before:top-0 before:text-fg-subtle before:font-bold">${inline(curItem.join(' '))}</li>`);
      curItem = [];
    }
  }
  function endList() {
    flushItem();
    if (inList) { out.push('</ul>'); inList = false; }
  }
  function startList() {
    if (!inList) { out.push('<ul class="my-[32px] space-y-[8px] list-none ml-[8px]">'); inList = true; }
  }

  for (const raw of lines) {
    if (inCode) {
      if (raw.trim().startsWith('```')) {
        const src = codeBuf.join('\n');
        // JS/TS fences get SSR syntax highlighting via the shared tokenizer
        // (colors match the home page and the ui docs). Every other fence,
        // INCLUDING a bare no-language fence (sh, plain command output, JSON),
        // stays plain escaped text: JS-tokenizing shell output mis-colors it.
        const HIGHLIGHTED = new Set(['ts', 'tsx', 'js', 'jsx', 'javascript', 'typescript']);
        const body = HIGHLIGHTED.has(codeLang.toLowerCase())
          ? highlightToHtml(src)
          : src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        out.push(`<pre class="bg-bg-subtle border border-border rounded-lg my-[48px] overflow-x-auto"><code class="font-mono text-[13px] leading-[1.7] text-fg whitespace-pre block px-[24px] py-[20px]"${codeLang ? ` data-lang="${codeLang}"` : ''}>${body}</code></pre>`);
        codeBuf = [];
        codeLang = '';
        inCode = false;
      } else {
        codeBuf.push(raw);
      }
      continue;
    }
    if (raw.trim().startsWith('```')) {
      endList();
      inCode = true;
      codeLang = raw.trim().slice(3).trim();
      continue;
    }
    const line = raw;
    if (/^# /.test(line)) {
      endList();
      out.push(`<h2 class="font-serif text-[clamp(26px,3.5vw,34px)] leading-[1.18] tracking-tight text-fg mt-[80px] mb-[24px]">${inline(line.slice(2).trim())}</h2>`);
    } else if (/^## /.test(line)) {
      endList();
      out.push(`<h3 class="font-serif text-[clamp(21px,2.8vw,26px)] leading-[1.2] tracking-tight text-fg mt-[56px] mb-[20px]">${inline(line.slice(3).trim())}</h3>`);
    } else if (/^### /.test(line)) {
      endList();
      out.push(`<h4 class="font-mono text-[12px] uppercase tracking-[0.18em] font-semibold text-fg-subtle mt-[40px] mb-[16px]">${inline(line.slice(4).trim())}</h4>`);
    } else if (/^> /.test(line)) {
      endList();
      out.push(`<blockquote class="border-l-2 border-accent pl-[20px] my-[40px] italic text-fg-muted dark:text-fg text-[17px] leading-[1.7]">${inline(line.slice(2).trim())}</blockquote>`);
    } else if (/^- /.test(line)) {
      flushItem();
      startList();
      curItem.push(line.slice(2).trim());
    } else if (inList && /^ {2,}\S/.test(line)) {
      curItem.push(line.trim());
    } else if (line.trim() === '') {
      flushItem();
    } else {
      endList();
      out.push(`<p class="text-fg-muted dark:text-fg text-[17px] leading-[1.8] my-[28px]">${inline(line.trim())}</p>`);
    }
  }
  endList();
  return out.join('\n');
}
