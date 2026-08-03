import { html } from '@webjsdev/core';
import type { TemplateResult } from '@webjsdev/core';

/**
 * A composed page fragment (the lib/ui convention): an SSR-time function
 * returning html. It renders and disappears. Nothing here registers a custom
 * element. Interactive elements live in components/.
 */

/**
 * The shared documentation shell: the page-tree sidebar column plus the
 * content column, extracted from app/docs/layout.ts so the component
 * library at /ui renders the exact same chrome as /docs instead of
 * growing a parallel copy that drifts.
 *
 * Both consumers are NON-ROOT layouts (invariant 8), so this writes no
 * document shell. The header, footer, theme toggle, fonts, and design
 * tokens all come from app/layout.ts, and the sidebar is the only
 * section-specific chrome.
 *
 * This file is now only two things: the shell's stylesheet, and the function
 * that turns a `nav` tree into markup. The drawer itself is
 * components/docs-drawer.ts, which owns its markup, its open state, and every
 * listener that can close it. Only one shell is ever on a page at a time, so
 * the #docs-sidebar id stays safe.
 */

export type ShellNavItem = { href: string; label: string };
export type ShellNavSection = {
  title: string;
  /**
   * Optional item count rendered right-aligned on the section header, the
   * way the component library labels its tiers. Absent on the docs.
   */
  count?: number;
  items: ShellNavItem[];
};

export type DocsShellOptions = {
  /** Sidebar sections, rendered in order. */
  nav: ShellNavSection[];
  /** aria-label for the <aside>, e.g. "Documentation". */
  label: string;
  /** Visible text on the mobile drawer toggle, e.g. "Documentation menu". */
  menuLabel: string;
  /**
   * Extra content placed at the top of the sidebar, before the nav
   * (the docs put their search field here).
   */
  asideTop?: unknown;
  /**
   * Class for the content wrapper around children. The docs pass
   * 'prose-docs' so every page body gets the documentation typography; the
   * component library passes '' because its pages carry live component
   * previews that the unlayered .prose-docs rules would restyle (they win
   * over Tailwind utilities), and wrap only their genuinely prose regions
   * in .prose-docs themselves.
   */
  contentClass: string;
  /** Typed, not `unknown`: both callers pass a layout's `children`, which
   *  `LayoutProps` already types. `asideTop` above stays `unknown` because it
   *  is an arbitrary hole value this helper accepts from anywhere. */
  children: TemplateResult;
};

export function docsShell({ nav, label, menuLabel, asideTop, contentClass, children }: DocsShellOptions) {
  return html`
    <style>
      /* Content typography for doc pages, scoped under .prose-docs so the
         same element tags inside the shared header, footer, and sidebar stay
         unaffected.

         This deliberately tracks the site's OTHER long-form surface, the blog
         post renderer in lib/render-post.ts: serif headings in --fg, no rules
         between sections, code in a --bg-subtle card, an accent-bar
         blockquote with no fill. The docs previously had their own voice here
         (an orange h1, a border-top on every h2, near-black code blocks) and
         that mismatch is what made them read as a different site even after
         they moved onto this one.

         The one deliberate divergence is RHYTHM. A blog post breathes at
         80px between sections; a reference page with forty of them would just
         be scrolling. So the scale is the site's and the spacing is tighter. */
      .prose-docs h1 {
        font: 700 var(--text-doc-h1)/1.12 var(--font-serif);
        letter-spacing: -0.025em;
        margin: 0 0 20px;
        color: var(--fg);
      }
      .prose-docs h2 {
        font: 700 var(--text-doc-h2)/1.18 var(--font-serif);
        letter-spacing: -0.02em;
        color: var(--fg);
        margin: 56px 0 16px;
      }
      .prose-docs h3 {
        font: 700 1.15rem/1.3 var(--font-serif);
        letter-spacing: -0.01em;
        color: var(--fg);
        margin: 36px 0 10px;
      }
      .prose-docs p  { margin: 0 0 18px; font-size: 17px; line-height: 1.75; overflow-wrap: anywhere; }
      /* Tailwind's preflight strips list-style from every ul/ol, so without
         restating it here a docs list renders as indented plain text with no
         markers at all, and the indent then reads as an arbitrary layout
         inconsistency instead of a list. The rule for indentation across the
         docs is exactly this: text sits flush unless it carries a marker, and
         the 24px inset exists only to house that marker. */
      .prose-docs ul { list-style: disc; padding-left: 24px; margin: 0 0 18px; }
      .prose-docs ol { list-style: decimal; padding-left: 24px; margin: 0 0 18px; }
      .prose-docs li { margin: 8px 0; font-size: 17px; line-height: 1.7; overflow-wrap: anywhere; }
      .prose-docs li::marker { color: var(--fg-subtle); font-size: 15px; }
      .prose-docs ol > li::marker { font-family: var(--font-mono); }
      .prose-docs a {
        color: var(--accent);
        text-decoration: underline;
        text-decoration-color: transparent;
        text-underline-offset: 3px;
        transition: text-decoration-color 140ms;
      }
      .prose-docs a:hover { text-decoration-color: currentColor; }
      .prose-docs hr {
        margin: 56px 0;
        border: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
      }
      .prose-docs pre {
        margin: 0 0 24px;
        padding: 20px 24px;
        border-radius: 12px;
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        overflow-x: auto;
        font: 13px/1.7 var(--font-mono);
        color: var(--fg);
      }
      .prose-docs code {
        font-family: var(--font-mono);
        font-size: 0.86em;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        overflow-wrap: anywhere;
      }
      .prose-docs pre code { padding: 0; border: 0; background: transparent; font-size: inherit; }
      .prose-docs strong { font-weight: 700; color: var(--fg); }
      .prose-docs blockquote {
        margin: 28px 0;
        padding: 0 0 0 20px;
        border-left: 2px solid var(--accent);
        color: var(--fg-muted);
        font-size: 17px;
        line-height: 1.7;
        font-style: italic;
      }
      .prose-docs table {
        width: 100%;
        margin: 0 0 24px;
        border-collapse: collapse;
        font-size: 15px;
      }
      .prose-docs th, .prose-docs td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; }
      .prose-docs th { font-weight: 600; color: var(--fg); }

      /* The sidebar sticks BELOW the shared fixed header, so it reads
         --header-h from the root layout rather than assuming a bare viewport.
         Only the offset is docs-specific; the header itself is shared.

         It is deliberately TRANSPARENT on desktop: no panel fill, no divider
         rule. The root layout paints one warm glow across the whole viewport
         behind the content, and an opaque sidebar would mask it on the left
         while the content column kept it, splitting the page into two
         different backgrounds and making the docs read as a separate app
         bolted onto the site. The same reason the marketing pages carry no
         panel behind their nav. */
      .docs-sidebar {
        position: sticky;
        top: var(--header-h);
        height: calc(100vh - var(--header-h));
      }

      /* The NAV scrolls, not the sidebar: anything pinned at the top of the
         column (the docs search field) stays put rather than scrolling out of
         reach, and the scrollbar spans only the link list instead of running
         the full height of the column. Hidden until hover, matching the
         .scroll-thin treatment the root layout defines for the marketing
         pages. */
      .docs-nav { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color 300ms; }
      .docs-nav:hover { scrollbar-color: var(--border-strong) transparent; }
      .docs-nav::-webkit-scrollbar { width: 6px; }
      .docs-nav::-webkit-scrollbar-track { background: transparent; }
      .docs-nav::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
      .docs-nav:hover::-webkit-scrollbar-thumb { background: var(--border-strong); }
      .docs-nav::-webkit-scrollbar-thumb:hover { background: var(--fg-subtle); }

      /* Mobile: the sidebar becomes a drawer sliding in from the left,
         toggled by an open attribute <docs-drawer> reflects. Selecting on
         the component's own host is what replaced a body attribute: the state
         now lives with the element that owns it, so it cannot survive a
         navigation that removes the element, and it cannot collide with the
         shared header's own mobile menu.

         The drawer opens BELOW the shared header rather than over it, and
         that is load-bearing, not a taste call. The root layout wraps
         children in a relative z-1 element, which is a stacking context,
         so nothing rendered in here can paint above the z-20 header no
         matter what z-index it claims: a full-height drawer would have its
         top band buried under the header, with the clicks going to the
         header instead. Starting at --header-h sidesteps the stacking
         context entirely and leaves the header usable while the drawer is
         open. */
      .docs-backdrop { display: none; }
      /* 899.98, not 900: the collapse must flip at the same moment as the
         max-wide: utilities (--breakpoint-wide: 900px), and a hand-written
         900px max-width would OVERLAP the 900px min-width for one device
         pixel. Keep this in step with --breakpoint-wide in input.css. */
      @media (max-width: 899.98px) {
        .docs-sidebar {
          position: fixed;
          top: var(--header-h); left: 0; bottom: 0;
          width: 280px; max-width: 85vw;
          height: auto;
          z-index: 40;
          transform: translateX(-100%);
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1);
          box-shadow: 4px 0 24px oklch(0 0 0 / 0.25);
          /* The drawer DOES need a fill, unlike the desktop sidebar: it floats
             over the content it is covering, so it has to be opaque. Scoped to
             this breakpoint so the desktop column stays transparent over the
             page glow. */
          background: var(--bg-elev);
          border-right: 1px solid var(--border);
          padding-top: 1.5rem;
        }
        /* Off-screen is not enough: a translated element keeps every link
           in the tab order, so a keyboard user tabbing off the menu button
           walked 45 invisible controls before reaching the page. Hiding it
           removes them, and delaying the visibility change until the slide
           finishes keeps the close animation. */
        .docs-sidebar {
          visibility: hidden;
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1), visibility 0s linear 220ms;
        }
        docs-drawer[open] .docs-sidebar {
          transform: translateX(0);
          visibility: visible;
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1), visibility 0s;
        }
        .docs-backdrop {
          display: block;
          position: fixed;
          top: var(--header-h); left: 0; right: 0; bottom: 0;
          background: oklch(0 0 0 / 0.5);
          opacity: 0; pointer-events: none;
          transition: opacity 220ms;
          z-index: 30;
        }
        docs-drawer[open] .docs-backdrop { opacity: 1; pointer-events: auto; }
        /* No overflow hidden rule here. The page scroll lock is a document
           level effect that has to MEASURE what hiding the scrollbar did to the
           viewport, so it lives in lib/scroll-lock.ts and is driven from the
           component's update cycle. A CSS-only lock cannot measure, which is
           exactly why the pure-CSS version shifted the fixed header (#1147). */

        /* A wide table has to scroll inside its own box here, or it pushes the
           DOCUMENT past the viewport and drags the shared fixed header with
           it. A display of block is what makes overflow apply to a table at
           all, and it is scoped to this breakpoint because it also shrinks
           the table to fit its content, which on a wide screen leaves the row
           rules stopping short of the column edge. */
        .prose-docs table {
          display: block;
          max-width: 100%;
          overflow-x: auto;
        }
      }
    </style>

    <!-- Everything structural and interactive now belongs to the drawer
         component, which owns the backdrop, the grid, the aside, the toggle,
         and every listener that can close it. What stays here is what this
         file is actually for, turning the nav DATA into markup, which it
         hands over through a slot.

         The nav is SLOTTED rather than passed as a .nav property on purpose.
         A property round-trips through SSR as a serialized data-webjs-prop-*
         attribute, so the whole tree would ship twice on every docs page, once
         as the links below and once as JSON. This app already turned action
         seeding off (package.json "seed": false) over that same duplication. -->
    <docs-drawer
      label=${label}
      menu-label=${menuLabel}
      content-class=${contentClass}
    >
      ${asideTop ? html`<div slot="aside-top">${asideTop}</div>` : ''}
      <div slot="nav">
        ${nav.map((s) => html`
          ${typeof s.count === 'number'
            ? html`<div class="flex items-baseline justify-between px-2 mt-6 mb-2 first:mt-0">
                <span class="font-mono text-xs font-semibold tracking-widest uppercase text-fg-subtle">${s.title}</span>
                <span class="font-mono text-xs text-fg-subtle">${s.count}</span>
              </div>`
            : html`<div class="font-mono text-xs font-semibold tracking-widest uppercase text-fg-subtle px-2 mt-6 mb-2 first:mt-0">${s.title}</div>`}
          ${s.items.map((it) => html`
            <a class="block py-1.5 px-2 my-px rounded-md text-fg-muted no-underline text-sm transition-colors duration-150 hover:text-fg hover:bg-bg-subtle" href=${it.href}>${it.label}</a>
          `)}
        `)}
      </div>
      ${children}
    </docs-drawer>
  `;
}
