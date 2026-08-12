import { html } from '@webjsdev/core';
import '#components/copy-cmd.ts';
import '#components/like-button.ts';
import { COMPONENT_SAMPLE, TOGGLE_SAMPLE, ACTION_SAMPLE, PAGE_SAMPLE, USAGE_SAMPLE } from '#lib/samples.ts';
import { DOCS_START_PATH, GALLERY_URL, GH_URL, NEW_TAB, SAME_AS } from '#lib/links.ts';
// highlight() runs only at SSR (codeWindow renders its output into the served
// HTML), but it does ship to the client as a small dead module: the page loads
// in the browser to register copy-cmd, and that pulls in its
// top-level imports. This is an accepted cost. It cannot move to a .server.ts
// util (a server-only stub throws at load, and this is a page top-level import)
// and it is not elision-eligible (only display-only components are elided, and
// an elision-eligible component cannot take a reactive property, so routing the
// code through one would just duplicate the raw sample in the HTML). Its only
// dependency, html, is already loaded by the components, so the real cost is a
// single tiny module fetch.
import { highlight } from '#lib/utils/highlight.ts';
import { BTN_PRIMARY, BTN_GHOST, INSTALL} from '#lib/design/recipes.ts';
import { ctaPanel } from '#lib/ui/cta-panel.ts';

// The home page intentionally sets NO title/description/og here. The root
// layout's generateMetadata is the single source for the <title>, description,
// and the og/twitter tags, so they stay consistent (a page-level title override
// would win for <title> but leave og:/twitter: showing the layout's title,
// splitting the canonical share target's name across the tab and the social
// card). It DOES contribute site-level JSON-LD (WebSite + Organization +
// SoftwareApplication): metadata is shallow-merged layout-then-page, so adding
// only `jsonLd` leaves the layout's title/og untouched while emitting the
// structured data on the site's most-linked page.
const SITE_URL = 'https://webjs.dev';
export const metadata = {
  jsonLd: [
    // Every node carries an @id. Three of these share a name and a url, so
    // without one a crawler cannot tell whether they are three descriptions
    // of one thing or three things, and the two that also share a sameAs
    // would differ only by @type. The @id says plainly which is which: the
    // project as an organisation, the software it publishes, and the site
    // you are reading. Consolidating a contested name is the point of the
    // sameAs, and that only works if what is being consolidated is named.
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      name: 'WebJs',
      url: SITE_URL,
      description: 'An AI-first, web-components-first full-stack web framework with no build step.',
      publisher: { '@id': `${SITE_URL}#organization` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_URL}#organization`,
      name: 'WebJs',
      url: SITE_URL,
      logo: `${SITE_URL}/public/favicon.png`,
      // Every owned property, from the one shared list in lib/links.ts, so
      // this node, the SoftwareApplication below it, and the one on
      // /what-is-webjs all state the same entity graph (#1100).
      sameAs: SAME_AS,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      // The SAME id as the node on /what-is-webjs, which is what makes them
      // one software entity described twice rather than two that happen to
      // agree. That is also why both carry the identical sameAs.
      '@id': `${SITE_URL}#software`,
      name: 'WebJs',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js 24+, Bun',
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}#organization` },
      sameAs: SAME_AS,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

// The page is written as ONE argument, not as a list of features, and the
// section ledes are what carry it. Each one opens by picking up the idea the
// previous section closed on:
//
//   hero              what this is, and what your agent does with it
//   first paint       the server sends a finished page, and only the
//                     interactive parts load after it
//   nothing           the editor file and the network-tab file are one file,
//   compiled away     and the action beside it never ships at all
//   browser is the    everything here falls out of that one decision
//   framework
//   the app has a     the demos teach, the clear removes them, the shape
//   shape             stays. pays off the hero's first half
//   works without     the backend template is the option nobody expects, and
//   a UI too          it is what converts a reader who thinks this is UI-only.
//                     NOT "Start where you are": that collided with the CTA
//                     heading "Start building with AI" directly below it.
//
// Rewriting a lede in isolation is what breaks this: the hand-off is in the
// FIRST sentence of each, so a lede that opens on its own section's topic
// leaves the page reading as a spec sheet again. Move a section and the two
// ledes on either side of the seam have to move with it.
//
// EVERY SECTION MUST STAND ALONE. This outranks the hand-off above whenever the
// two conflict. Readers arrive mid-page from a search result or a shared link,
// so a header and its opening sentence have to resolve with nothing above them.
// Test it by reading the header plus the first sentence with everything above
// covered. Four failed that test at once and every failure was a backward
// reference: "That first paint" (which paint?), "By the time the demos go"
// (what demos?), "All of it arrives" (all of what?), and the header "Your agent
// reaches before it writes" (reaches where?).
//
// PROTECTIVE repetition is allowed. The anti-repetition rule below is about
// re-making an ARGUMENT, which is waste, and that is why two bento cards were
// deleted for restating whole sections. It does NOT cover a line that stops a
// fast scroller forming a wrong impression from the section they landed on.
// "It works without a UI too" therefore repeats two things on purpose: that the app
// arrives with demos AND that one command clears them, and that the defaults
// are swappable. Someone who lands there cold and reads only "you get a working
// app full of demos" bounces, and the fix for that is not upstream prose they
// did not read. Cut an echo when missing it costs the reader nothing. Keep it
// when missing it costs them the wrong idea.
//
// A sequential reader loses nothing, because a self-contained opening still
// echoes the section above it. "The file in your editor and the file in the
// network tab are the same file" reads as the next step if you came from "The
// first paint is the whole page" and as a plain claim if you did not. Get both,
// do not trade one for the other.
//
// But a hand-off must not be BOUGHT with a false claim, which is how that lede
// read for a long time: "A first paint is only honest if what you wrote is what
// shipped." It chains beautifully off the section above and it is not true.
// Whether the first paint is complete and whether the shipped bytes match your
// source are unrelated properties, and a Rails or PHP app with a bundled
// frontend has a perfectly honest first paint. A reader who thinks about the
// sentence for one second catches it, which is the worst possible place to lose
// them: the section directly below is the one asking to be trusted. State the
// section's own claim plainly and let the sequence be a bonus.
//
// A lede may hand BACK to the section above, but it must NAME what it is
// handing back to. A bare pronoun cannot survive the trip, because a large
// heading sits between the pronoun and its referent and steals the antecedent.
// "That first paint arrives..." works, since it names the thing. Three ledes
// once did not and all three read as broken:
//
//   "Everything below falls out of that one decision"  which decision?
//   "All of that only helps if the agent finds it"     all of what?
//   "That is true of your code"                        read as referring to the
//                                                      header directly above it,
//                                                      which INVERTED the meaning
//
// Name it, or open on something self-contained. Do not write "as the previous
// section showed" either: that is documentation voice and it makes the reader
// do bookkeeping.
//
// The trap is easy to fall into WHILE FIXING one of these. The replacement for
// the third was "When it needs to go deeper than that, it can", which is the
// same defect wearing different words. If your fix still contains a bare
// "that", "this", "the above", or a comparative with no stated baseline, it is
// not fixed. Read the first sentence with the heading covering everything above
// it: if it still resolves, it is done.
//
// The HEADERS carry their own rule, learned by getting it wrong twice. Each is
// a self-contained CLAIM, never a label for the contents and never a pointer at
// something the reader has not read yet. "Modern full-stack, on web standards"
// was the label version, and "It all falls out of one decision" was the pointer
// version, which fails because a reader cannot resolve WHICH decision from the
// header alone. The consequence link belongs in the lede's first sentence,
// where there is room to name what it refers back to.

// The one surviving measured number, rendered under the bento. It was a
// four-stat grid in its own section; three of those stats restated sections
// above them and the section resisted every header it was given, so it went.
// This one stays because it answers the objection the bento raises, which is
// that a framework with everything in it must be heavy.
//
// MEASURE BEFORE EDITING. It has been stale once, at ~29 KB, which made the
// derived multiplier wrong too:
//   curl -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' \
//     https://webjs.dev/__webjs/core/dist/webjs-core-browser.js
// The importmap points @webjsdev/core at that exact file, so it is what a
// visitor pays, and it INCLUDES the client router that index-browser.js
// side-effect-imports. The ~99 KB Next baseline is the full one (react +
// react-dom + the Next runtime + the app-router client).

// The interactive component / server action / page samples live in
// #lib/samples.ts and render through codeWindow() in "Show, don't tell".

// Chips for the progressive-enhancement section: the concrete things that
// keep working with JavaScript disabled, because the server sends real HTML.
// 'No whole-page hydration' is the precise form and the ONLY one to use here.
// WebJs does hydrate: a shipping component loads @webjsdev/core, and
// createInstance() in render-client.js does container.replaceChildren(...),
// which discards the server's DOM and rebuilds from the compiled template.
// What is absent is the whole-tree walk. Hydration is scheduled per element by
// the browser's own custom-element upgrade, pages and layouts never hydrate at
// all, and elided components never ship. Anything shorter ("no hydration
// runtime", "no hydration overhead") reads as zero cost and is refuted by one
// look at the network tab.
const PE_CHIPS = ['No whole-page hydration', 'Content reads', 'Links navigate', 'Forms submit', 'Display components ship 0 KB'];

// The hero stage shows this source beside the very component it declares,
// running. Keep the two in step: the panel to its right is a real
// <like-button>, so an edit here that drifts from components/like-button.ts
// turns the page's central claim into a lie.
const HERO_SAMPLE = `class LikeButton extends WebComponent({ count: Number }) {
  render() {
    return html\`<button @click=\${() => this.count++}>
      ♥ \${this.count}
    </button>\`;
  }
}
LikeButton.register('like-button');

// No build step. No bundler. No virtual DOM.
// The live button is this file, server-rendered
// and upgraded in place. Click it.`;

const WIN = 'flex flex-col flex-1 m-0 min-w-0 max-w-full rounded-2xl overflow-hidden border border-border bg-bg-subtle shadow-[var(--shadow)]';
const WINBAR = 'flex items-center gap-1.5 h-10 px-3.5 border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]';
const WINNAME = 'ml-2 font-mono font-medium text-xs leading-none text-fg-subtle';
const DOTS = html`<span class="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>`;
// Bento-grid card wrapper, shared by the "Why webjs" and "Small by design" cells.
const CARD = 'p-6 bg-bg-elev hover:bg-[color-mix(in_oklch,var(--bg-elev)_92%,var(--fg))] transition-colors duration-200 flex flex-col justify-between h-full';

function codeWindow(title: string, sample: string) {
  return html`
    <figure class=${WIN}>
      <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>${title}</span></figcaption>
      <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label=${title + ' code sample'}><code>${highlight(sample)}</code></pre>
    </figure>
  `;
}

export default function LandingPage() {
  return html`
    <style>
      /* Editor + code tokens for the Show-dont-tell code windows and the
         Why-webjs code cards. The editor surfaces reference the theme's own
         semantic tokens, so they track light/dark with no duplication; only
         the three syntax hues need a dark override. */
      :root {
        --editor-bg: var(--bg-elev);
        --editor-sidebar-bg: var(--bg-subtle);
        --editor-tab-bg: var(--bg-sunken);
        --editor-active-tab-bg: var(--bg-elev);
        --editor-status-bg: var(--bg-sunken);
        --editor-border: var(--border);
        --editor-fg: var(--fg);
        --editor-gutter-fg: var(--fg-subtle);
        --editor-gutter-border: var(--border);
        --code-tag:  light-dark(oklch(0.55 0.13 250), oklch(0.78 0.13 250));
        --code-attr: light-dark(oklch(0.52 0.16 150), oklch(0.66 0.16 150));
        --code-str:  light-dark(oklch(0.55 0.13 145), oklch(0.80 0.15 145));
        --code-text: var(--fg);
        --code-punc: var(--fg-muted);
      }
      /* Syntax-highlight token colors (.t-kw / .t-str / ...) are defined
         globally in public/input.css so every surface (this page and the
         blog code fences) shares one palette. */
      /* The live like-button demo: a bare light-DOM button the page styles
         into a pill (tag-prefixed, per the light-DOM CSS rule). */
      like-button button {
        display: inline-flex; align-items: center; gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--bg-elev);
        color: var(--fg);
        font-size: 13px; font-weight: 500; line-height: 1;
        cursor: pointer;
        transition: border-color 140ms, background-color 140ms;
      }
      like-button button:hover { border-color: var(--border-strong); }
      /* The hero copy of the same element, scaled up. It is the one thing on
         the page a reader is invited to click, so it is sized as a control
         rather than as an inline badge, and it is the single surface where the
         brand accent appears as a hover state. */
      .hero-stage like-button button {
        gap: 0.5rem;
        padding: 0.7rem 1.25rem;
        border-radius: 0.75rem;
        font-size: 16px;
        font-weight: 600;
      }
      .hero-stage like-button button:hover {
        border-color: var(--accent);
        background: color-mix(in oklch, var(--accent) 10%, var(--bg-elev));
      }
      .hero-stage like-button button:active { transform: translateY(1px); }
    </style>

    <main id="main" tabindex="-1" class="focus:outline-none">
    <section class="px-6 pt-12 md:pt-20 lg:pt-28 pb-10 md:pb-14 lg:pb-18">
      <div class="text-center">
        <!-- Same clamp curve as --text-display but with the ceiling lowered from
             5.5rem to 4.5rem, and a max-width in REM rather than ch. Both are
             deliberate. This headline is 59 characters where the token was tuned
             for 31, and at 5.5rem its first sentence alone ran 1222px inside a
             1464px container, so the line broke mid-second-sentence and the
             headline sprawled edge to edge. 4.5rem with 62rem breaks it exactly
             at the full stop, one claim per line. 64rem is 1024px against a measured
             1008.66px first sentence, so the margin is 15px. Measure an UNWRAPPED
             clone: summing a Range getClientRects() over already-wrapped text
             sums the line fragments and gives the wrong number.

             The max-width MUST NOT be in ch. A previous attempt used max-w-[32ch]
             which computes to 1918px at this font size, wider than the container,
             so it constrained nothing at all. ch scales with the font, which is
             the whole trap.

             NO text-balance here either, for the same reason. Balancing splits
             the headline into evenly weighted lines, which produced three lines
             breaking mid-word ("Conventions your agent f") even though the first
             sentence fits its line with 13px to spare. The max-width IS the line
             break, so greedy filling is what we want. -->
        <!-- The clamp FLOOR is the thing to be careful with, not the max. It was
             2.9rem (46.4px), which the preferred term reaches at a 476px viewport,
             so every phone rendered the identical 46.4px and the size stopped
             responding exactly where it mattered: 58 characters at 46.4px in a
             342px box is 5 ragged lines and a 237px-tall headline. The floor is
             now 1.75rem, reached only below 264px, so the size is genuinely fluid
             across every real device. The slope was steepened to match, and the
             cap trimmed to 4.125rem (66px), which still lands at ~1044px so the
             desktop crossover point has not moved.
             Re-measure line counts at 390 / 768 / 1440 before touching any of the
             three numbers; they are chosen against the wrap points, not picked. -->
        <h1 class="font-display font-extrabold text-[clamp(1.75rem,0.93rem+4.9vw,4.125rem)] leading-[1.02] tracking-[-0.038em] mx-auto mt-2 mb-6 max-w-[64rem]">
          Conventions your agent follows. Architecture you still own.
        </h1>
        <p class="text-lede leading-[1.55] text-fg-muted max-w-[62ch] mx-auto mb-9 text-pretty">
          <span class="text-fg font-medium">WebJs is a full-stack web components framework with no build step.</span>
          Conventions guide the first prompt to production-ready code, so fewer
          tokens go to plumbing. What your agent writes reaches the browser line
          for line, so it debugs real code and you read exactly what runs.
        </p>
        <div class="flex gap-3 justify-center flex-wrap items-center">
          <a class=${BTN_PRIMARY} href=${DOCS_START_PATH}>
            Get started
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
          <a class=${BTN_GHOST} href=${GH_URL} target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.58l-.01-2.03c-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.72-1.34-1.72-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.51.12-3.15 0 0 1-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.3-1.53 3.3-1.21 3.3-1.21.65 1.64.24 2.85.12 3.15.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22l-.01 3.29c0 .33.22.7.83.58A12.01 12.01 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z"/></svg>
            Star on GitHub${NEW_TAB}
          </a>
        </div>
        <div class="mt-6 flex justify-center">
          <div class=${INSTALL}>
            <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
          </div>
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">The first paint is the whole page</h2>
          <!-- 31 words, down from 106, and the shortening was a FACT-CHECK rather
               than an edit. The old version made three claims about frameworks in
               general and not one of them survived being checked against the Next
               source sitting on this machine.
                 "The runtime has to load, parse, and hydrate before the page can
               be read at all" is false: Next server-renders client components too
               (use-flight-response.tsx feeds the Flight stream through
               createFromReadableStream with an ssrModuleMapping, and next/dynamic
               defaults to ssr: true), so its HTML reads immediately.
                 "Every page pays for the runtime" is true of the App Router, whose
               getRequiredScripts throws an invariant on an empty script list, and
               false of the Pages Router, which has unstable_runtimeJS: false.
                 "A page with nothing interactive ships none at all" is true of
               this framework (ssr.js emits no <script> when moduleUrls is empty)
               and describes a case almost no app reaches, since one interactive
               component in the root layout puts every page under it back on the
               runtime. This website is the proof: all five routes ship core,
               because the layout renders theme-toggle and site-nav-menu.
                 So the rule for this lede: claim nothing about another framework
               and nothing that needs a footnote about which configuration you are
               in. The chips below enumerate, the P.S. below runs the comparison
               in the reader's own browser, and the prose only has to be true.

               The term "progressive enhancement" comes LAST, after the three
               concrete behaviours, and it is the one label allowed in here. Put
               it first and a reader pattern-matches it to no-JS purism and skips
               the section, which is a constraint they think they know rather
               than a capability they can check. After the demonstration it is a
               handle for what they just read, plus the phrase they would search
               for, next to the brand name. That naming is also why this lede
               says WebJs at all: nothing else in the section does, and someone
               arriving here from a search result needs to know whose page this
               is. "Here it is the default" said nothing to them. -->

          <p class="text-fg-muted text-base leading-[1.6] m-0">
            The server sends a finished page. It reads, its links navigate, and
            its forms submit before a single script runs. What loads afterwards
            is only the components that are actually interactive. That is
            progressive enhancement, and with WebJs it is the default rather
            than an effort.
          </p>
          <!-- The dare belongs to THIS section, whose chips below enumerate the
               very things it invites you to check. It stays a dare by naming
               nobody: it asserts nothing about any other site, so it cannot go
               stale when somebody else redeploys, and it links nowhere, so it
               does not hand the page's highest-intent readers to a competitor.
               The pun carries the target.

               Everything it DOES claim about this page is true with JS off: the
               content reads, an <a> navigates, and the palette follows the OS
               because it is light-dark() in CSS rather than a class an inline
               script applies. What does NOT survive is an explicitly toggled
               theme, whose bootstrap script cannot run, and the live demos. That
               is why the sentence lists what works rather than claiming
               everything does. Keep it that way: the whole point of an
               invitation to go and check is that checking confirms it. -->
          <p class="text-sm leading-[1.6] text-fg-subtle max-w-[62ch] mx-auto mt-5 mb-0 text-pretty">
            P.S. Turn JavaScript off and reload. It still reads, navigates, and
            respects your system theme. Then try that on the <em>next</em>
            framework's website that comes to mind. 😉
          </p>
        </div>

        <div class="hero-stage max-w-5xl mx-auto grid grid-cols-1 wide:grid-cols-2 rounded-2xl overflow-hidden border border-border-strong bg-bg-sunken shadow-[var(--shadow)]">
          <div class="min-w-0 border-b wide:border-b-0 wide:border-r border-border bg-bg-subtle">
            <div class=${WINBAR}>${DOTS}<span class=${WINNAME}>components/like-button.ts</span></div>
            <pre class="scroll-thin m-0 p-5 overflow-x-auto font-mono text-xs leading-[1.72] [tab-size:2] text-left" role="region" tabindex="0" aria-label="like-button component source"><code>${highlight(HERO_SAMPLE)}</code></pre>
          </div>
          <div class="group/stage flex flex-col min-w-0 bg-bg">
            <input type="checkbox" id="stage-usage" class="sr-only peer" />
            <div class="flex items-center justify-between gap-2 h-10 px-3.5 border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]">
              <span class="inline-flex items-center gap-1.5 font-mono text-xs text-fg-subtle">
                <span class="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)] transition-opacity group-has-[:checked]/stage:opacity-0"></span>live
              </span>
              <label for="stage-usage" class="cursor-pointer select-none font-mono font-semibold text-xs tracking-widest uppercase text-fg-subtle hover:text-fg transition-colors px-2 py-1 -mr-1 rounded-lg hover:bg-[var(--hover-surface)]">
                <span class="group-has-[:checked]/stage:hidden">Show usage</span>
                <span class="hidden group-has-[:checked]/stage:inline">Show rendered</span>
              </label>
            </div>
            <div class="flex-1 grid place-items-center px-6 py-10 group-has-[:checked]/stage:hidden">
              <like-button count="3"></like-button>
            </div>
            <pre class="hidden group-has-[:checked]/stage:block flex-1 m-0 p-5 overflow-x-auto font-mono text-xs leading-[1.72] text-left" role="region" tabindex="0" aria-label="like-button usage"><code>${highlight(USAGE_SAMPLE)}</code></pre>
            <div class="px-4 py-3 border-t border-border text-center font-mono text-xs leading-[1.5] text-fg-subtle">
              Server-rendered first, then upgraded. Click it.
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2.5 justify-center mt-8">
          ${PE_CHIPS.map(c => html`<span class="text-xs font-medium leading-none text-fg-muted px-3.5 py-2 rounded-full border border-border bg-bg-elev/40 backdrop-blur-sm shadow-[var(--shadow-sm)] hover:border-border-strong hover:bg-bg-subtle transition-all duration-[140ms]">${c}</span>`)}
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Nothing is compiled away</h2>
          <!-- The two windows below are NOT the same kind of file, and the lede
               must not say they are. It read "both served to the browser exactly
               as they sit on disk", which denies invariant 1: the action is a
               'use server' .server.ts, so it NEVER reaches the browser, and its
               import is rewritten to an RPC stub. The page does ship, with its
               types blanked to whitespace, so it is identical line for line and
               column for column rather than byte for byte. Saying so is also the
               better story, since the boundary is more interesting than the
               sameness. Check both windows against this sentence before editing
               either: the sample files decide what the sentence may claim.

               The lede does NOT make the type-safety point, on purpose. The
               "Call the server like a function" card two sections down already
               says the call site keeps the function's real argument and return
               types, and it has a client-to-server diagram beside it. A lede
               sentence here would be the same argument made twice, weaker, and
               without the picture. The sentence that used to sit here ("the
               types cross with the import...") was also carrying a claim that
               does not survive checking: codegen-free typing across the
               client / server boundary is what Next server actions and tRPC
               both already do, so "nothing is generated in between" describes
               the field rather than distinguishing this framework from it.

               "Typed RPC call" was likewise cut from the sentence above. Every
               clause around it is about what reaches the BROWSER, where the
               types are already whitespace, so "typed" there reads as if type
               information rides the wire. AGENTS.md says "typed RPC stub" and
               means typed at author time, which is right for a reference doc
               and misleading in a sentence whose subject is what ships. -->

          <p class="text-fg-muted text-base leading-[1.6] m-0">The file in your editor and the file in the browser network tab are the same file. Here is a server action and the page that calls it. The page ships as you see it. The action never ships at all, and its import becomes an RPC call. Rails has shipped its default frontend without a bundler since Rails 7 in 2021, so the approach has production miles behind it.</p>
        </div>
        <div class="grid gap-6 grid-cols-1 md:grid-cols-2 max-w-5xl mx-auto">
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">Server action (RPC)</p>
            ${codeWindow('actions/get-post.server.ts', ACTION_SAMPLE)}
          </div>
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">SSR page</p>
            ${codeWindow('app/posts/[id]/page.ts', PAGE_SAMPLE)}
          </div>
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">The browser is the framework. The rest is here.</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0">Everything below falls out of the decision to skip the build step. Staying close to the platform is usually where a framework starts asking you to give things up, so each card is a place WebJs takes the standard and keeps the ergonomics anyway. Everything you need to ship, none of the build toolchain you don't.</p>
        </div>
        <div class="grid gap-px overflow-hidden rounded-2xl border border-border bg-border grid-cols-1 xs:grid-cols-2 wide:grid-cols-3 shadow-[var(--shadow-sm)]">

          <!-- CARD RULE, same as the section headers: the h3 is a self-contained
               CLAIM that makes a scroller stop, the body is the payoff, and the
               inset carries the concrete noun so the grid still SKIMS. A reader
               who never reads a body should still be able to tell from the six
               insets that routing, data, auth, and the rest are covered, because
               "is this framework complete?" is the objection this grid exists to
               answer and no other section on the page answers it.

               Two cards were deleted rather than reworded when this grid was
               rewritten, and they should not come back: "Zero build step" and
               "Progressive enhancement" each restated a whole section the reader
               had just finished ("Nothing is compiled away" and "The first paint
               is the whole page"). They also contradicted this section's header,
               which promises the cards are what the BROWSER does not give you. -->
          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Your folders are the routes</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">A <code class="font-mono text-[0.9em]">page.ts</code> is a route, a <code class="font-mono text-[0.9em]">layout.ts</code> wraps everything under it, and a <code class="font-mono text-[0.9em]">route.ts</code> is an HTTP handler. Dynamic segments, groups, catch-alls, and error boundaries all follow the folder tree, so the URL map is the directory listing.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 font-mono text-xs leading-[1.7] text-[var(--editor-fg)] select-none">
              <div class="text-fg-subtle">app/</div>
              <div>&nbsp;&nbsp;page.ts<span class="text-fg-subtle"> → /</span></div>
              <div>&nbsp;&nbsp;posts/[id]/page.ts<span class="text-fg-subtle"> → /posts/7</span></div>
              <div>&nbsp;&nbsp;api/hooks/route.ts<span class="text-fg-subtle"> → POST</span></div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Call the server like a function</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Mark a file <code class="font-mono text-[0.9em]">'use server'</code> and import it. The call site keeps the function's real argument and return types with no code generation in between, and Date, Map, Set, BigInt, and Blob round-trip across the wire. You never hand-write a fetch.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 flex items-center justify-between text-xs font-mono select-none text-[var(--editor-fg)]">
              <div class="text-fg-subtle px-2 py-1 bg-[var(--editor-bg)] rounded border border-[var(--editor-border)]">Client</div>
              <div class="flex-1 flex items-center justify-center relative"><span class="h-px bg-[var(--editor-border)] flex-1 mx-2"></span><span class="absolute text-xs bg-[var(--editor-sidebar-bg)] text-[var(--accent-text)] px-1 border border-[var(--editor-border)] rounded">RPC</span></div>
              <div class="text-fg-subtle px-2 py-1 bg-[var(--editor-bg)] rounded border border-[var(--editor-border)]">Server action</div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Some components ship no JavaScript</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Components render on the server. An interactive one hydrates on its own when the browser upgrades its tag, and a display-only one is stripped from the browser entirely, module and vendor imports included.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-2.5 flex flex-col gap-1.5 font-mono text-xs text-[var(--editor-fg)] select-none">
              <div class="flex justify-between items-center gap-2 px-2 py-1 bg-[var(--editor-bg)] border border-[var(--accent-border)] rounded">
                <span>&lt;price-tag&gt;</span> <span class="text-[var(--accent-text)] whitespace-nowrap">0 KB</span>
              </div>
              <div class="flex justify-between items-center gap-2 px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] rounded text-fg-subtle">
                <span>&lt;add-to-cart&gt;</span> <span class="whitespace-nowrap">hydrates</span>
              </div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Slow data never blocks the first byte</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Wrap a slow region and the shell paints immediately while the data streams in behind it. Navigation is client-side already, with nothing to import and nothing to configure.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 flex flex-col gap-2 text-[var(--editor-fg)]">
              <div class="h-3 w-1/3 bg-[var(--editor-border)] rounded"></div>
              <div class="h-8 w-full bg-[var(--editor-bg)] rounded border border-[var(--editor-border)] flex items-center px-3 gap-2 select-none">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-text)]"></span><span class="text-xs font-mono text-fg-subtle">streaming data chunk...</span>
              </div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Auth is not a side quest</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Login, a signed session, and a protected route ship in the scaffold, on a real database with a schema and migrations from the first command. Memory store in dev, Redis when you configure one.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-2.5 flex flex-col gap-1.5 font-mono text-xs text-[var(--editor-fg)] select-none">
              <div class="flex justify-between items-center px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] rounded"><span>Login &amp; sessions</span> <span class="text-[var(--accent-text)]">&check;</span></div>
              <div class="flex justify-between items-center px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] rounded"><span>Database &amp; migrations</span> <span class="text-[var(--accent-text)]">&check;</span></div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.02em] mt-0 mb-2">The unglamorous half, included</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Caching, rate limiting, file storage, and WebSockets, sharing one pluggable store. The parts nobody demos and every production app needs.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 flex flex-wrap gap-1.5 justify-center select-none text-[var(--editor-fg)]">
              <span class="px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] text-fg-subtle text-xs font-mono rounded">Caching</span>
              <span class="px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] text-fg-subtle text-xs font-mono rounded">Rate limits</span>
              <span class="px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] text-fg-subtle text-xs font-mono rounded">File storage</span>
              <span class="px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] text-fg-subtle text-xs font-mono rounded">WebSockets</span>
            </div>
          </div>

        </div>
        <p class="mt-8 mx-auto max-w-3xl text-center text-base leading-[1.6] text-fg-muted">
          All of it in <span class="text-fg font-medium">43 KB gzipped</span>, client router
          included, with zero runtime dependencies. A minimal Next.js client bundle is
          around 99 KB.
        </p>
        <!-- The familiarity argument, rescued from the deleted stats section,
             where it read "Familiar from day one. WebJs uses Next.js-style
             file-based routing and lit-style web components". It is an adoption
             lever (your existing knowledge transfers, so trying this costs
             less) and nothing else on the page makes it.

             Stated as restraint rather than as a disclaimer. "WebJs is not
             trying to be unique" says the same thing and reads as an apology;
             "invents as little as possible" is the same restraint offered as a
             deliberate choice. Both halves are accurate: routing is the Next.js
             app/ tree, and the component API matches lit with reactive
             properties as the one documented divergence, which is why this says
             "as little as possible" rather than "nothing". -->
        <p class="mt-4 mx-auto max-w-3xl text-center text-base leading-[1.6] text-fg-muted">
          WebJs invents as little as possible. Routing follows the Next.js file
          conventions, components follow lit's, and everything under them is the
          platform, so what you already know transfers, and so does what your
          agent was trained on.
        </p>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">The app has a shape before your agent starts</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0">
            A scaffolded app arrives with a live demo of every feature WebJs
            ships, so your agent reads working code instead of guessing at an
            API. One command clears the demos and leaves the wiring, and the
            architecture stays decided either way, carried in a skill your agent
            reads on demand. When even that runs out, the framework's own source
            sits uncompiled in node_modules.
          </p>
        </div>
        <!-- THREE artifacts telling one arc: what arrives, what clearing leaves,
             and the shape that survives both. This section used to be two (a
             "Read the demos. Then delete them." section sat above it) and they
             were merged.

             The lede was 115 words, the longest on the page, and the merge is
             why: two windows did not survive it (the webjs ui add terminal and
             the design tokens) so their content was moved into the prose. The
             cards have since been rebuilt and both are back, in "How the UI is
             built". The sentence outlived its reason, and by then it was reading
             out the card headings: "where a feature's code goes" IS the second
             card, "how the palette is declared, and how a component arrives" IS
             the third. It is gone. Before adding prose here, check whether a
             card already shows it, because a window beats a clause every time.

             The payoff sentence went the same way, for the same reason one level
             up: "It starts on your feature instead of on the scaffolding" is what
             the H2 above already says, three inches away, and a scroller reads
             the heading rather than the fourth clause of a paragraph. Check the
             HEADER too, not just the cards.

             63 words now, from 115. That is close to the floor: what is left is
             four facts carried once each (the demos exist, one command removes
             them, the architecture is decided and lives in a skill, the source is
             readable). Cutting further costs content rather than duplication.

             What the lede must keep carrying is the LAST sentence, the framework
             source readable in node_modules. That is the one claim in this
             section no card illustrates, and grepping the page shows this is its
             only mention anywhere.

             Every one of these is COPIED FROM A REAL SCAFFOLDED APP, not
             composed for the page. Verified by running webjs create then
             npm run gallery:clear: 26 routes under app/features before,
             "Gallery cleared (44 paths removed)" as the actual stdout, and the
             module paths from the generated tree. Re-generate and re-run before
             editing any of them. The 26 and the 44 go stale quietly, and a
             plausible-looking invented path is exactly what a reader tries once.

             (No backticks in here, per invariant 9: a backtick inside an html
             template body closes the literal at JS-parse time, comment or not.
             This comment had two and took the page down until tsc caught it.

             And exactly ONE closing marker, at the very end. Appending a
             paragraph to a comment this long, it is easy to close it where your
             new text stops, which ends the comment mid-block and renders
             everything after it as visible page text. That shipped once. Note
             the closing marker cannot be written out even here, since typing it
             inside a comment is the very thing being warned about, so count the
             markers instead: openers and closers must be equal in this file.
             Neither tsc nor webjs check can see the mistake, because a
             prematurely closed comment is still valid TS and valid HTML. The
             only detector is looking at the page.) -->
        <div class="grid gap-4 grid-cols-1 wide:grid-cols-3 items-stretch">
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">What arrives, and what leaves</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>terminal</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="The feature gallery a scaffolded app ships with"><code><span class="text-accent">$</span> npm create webjs@latest my-app
<span class="text-accent">$</span> ls my-app/app/features
async-render   boundaries
auth           broadcast
caching        client-router
<span class="text-fg-subtle">... 26 in all</span>

<span class="text-accent">$</span> npm run gallery:clear
Gallery cleared (44 paths removed).
The skill and db wiring are kept.</code></pre>
            </figure>
          </div>
                    <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">Where the code goes</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>modules/</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="The modules architecture a scaffolded app ships with"><code>modules/auth/
  actions/signup.server.ts
  queries/current-user.server.ts
  types.ts
modules/forms/
  actions/send-message.server.ts
db/schema.server.ts
<span class="text-fg-subtle"># one feature, one folder. reads in</span>
<span class="text-fg-subtle"># queries, writes in actions, one</span>
<span class="text-fg-subtle"># function per file.</span></code></pre>
            </figure>
          </div>
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">How the UI is built</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>design system</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="Installing a kit component and the design tokens that theme it"><code><span class="text-accent">$</span> webjs ui add button
<span class="text-accent">✔</span> Wrote components/ui/button.ts

--background   --primary
--foreground   --border
--card         --muted
<span class="text-accent">class="bg-background ..."</span>
<span class="text-fg-subtle"># the component is a file you own.</span>
<span class="text-fg-subtle"># the palette is tokens, so</span>
<span class="text-fg-subtle"># restyling is editing them.</span></code></pre>
            </figure>
          </div>
                </div>
      </div>
    </section>


    <section id="templates" class="scroll-mt-24 py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">It works without a UI too</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0">Two starting points, one command each. One is full-stack, the other is routes and modules with no UI at all. Either gives you a working app with live feature demos rather than an empty directory, and one command takes the demos out whenever you want to start clean.</p>
        </div>
        <div class="grid gap-4 grid-cols-1 max-w-2xl mx-auto wide:grid-cols-2 wide:max-w-3xl">
          <div class="flex flex-col gap-3 p-6 min-w-0 rounded-2xl border border-border bg-bg-elev">
            <!-- "Default" is a MARKER beside the heading, not the words "The
                 default." trailing the paragraph, because someone comparing two
                 options reads the headings and may never reach the last line of
                 the body. The card also says "a database" rather than "Drizzle":
                 the vendor is named once, in the defaults paragraph below, which
                 is where "default, not a lock-in" lands. Naming it here too split
                 one idea across two places. -->
            <div class="flex items-center gap-2.5">
              <h3 class="font-display font-bold text-lg leading-[1.25] m-0">Full Stack</h3>
              <span class="font-mono text-[0.65rem] leading-none tracking-widest uppercase text-[var(--accent-text)] border border-[var(--accent-border)] rounded-full px-2 py-1">Default</span>
            </div>
            <p class="m-0 text-sm leading-[1.6] text-fg-muted">SSR pages, web components, server actions, a database, streaming, and a browsable feature gallery. Auth (login, sessions, a protected route) ships as a gallery card.</p>
            <pre class="scroll-thin m-0 px-3.5 py-3 overflow-x-auto rounded-lg border border-border bg-bg-subtle font-mono text-xs leading-[1.6] text-fg-muted" role="region" tabindex="0" aria-label="Example files in a full-stack app">app/page.ts
components/counter.ts
actions/posts.server.ts</pre>
            <div class="cmd-foot pt-2 mt-auto font-mono text-xs leading-[1.6] text-fg-muted max-w-full min-w-0"><copy-cmd>npm create webjs@latest my-app</copy-cmd></div>
          </div>
          <div class="flex flex-col gap-3 p-6 min-w-0 rounded-2xl border border-border bg-bg-elev">
            <h3 class="font-display font-bold text-lg leading-[1.25] m-0">Backend</h3>
            <p class="m-0 text-sm leading-[1.6] text-fg-muted">A backend-only app, no UI or SSR. File-based route handlers, modules, middleware, rate limiting, WebSockets, a database, and a backend-features gallery.</p>
            <pre class="scroll-thin m-0 px-3.5 py-3 overflow-x-auto rounded-lg border border-border bg-bg-subtle font-mono text-xs leading-[1.6] text-fg-muted" role="region" tabindex="0" aria-label="Example files in an API app">app/api/users/route.ts
app/api/chat/route.ts
middleware.ts</pre>
            <div class="cmd-foot pt-2 mt-auto font-mono text-xs leading-[1.6] text-fg-muted max-w-full min-w-0"><copy-cmd>npm create webjs@latest my-api -- --template api</copy-cmd></div>
          </div>
        </div>
        <p class="mt-8 mx-auto max-w-3xl text-center text-base leading-[1.6] text-fg-muted">Light DOM components, Tailwind, Drizzle, a modules layout, and design tokens are wired before you write a line. Every one of them is a default, not a lock-in. Swap what does not suit you.</p>
        <!-- max-w-4xl, not the max-w-3xl every other lede uses. The line is 782px
             set solid and a 3xl box is 768px, so it wrapped by 14px, which put one
             trailing clause on a second line under a centred first. 4xl gives 114px
             of slack, enough that a font substitution cannot re-wrap it, and it
             still folds to two lines below ~830px where two lines are correct. -->
        <p class="mt-6 mx-auto max-w-4xl text-center text-fg-subtle text-sm leading-[1.55]">Prefer Bun instead of Node.js? Flavor the whole scaffold for Bun by running <copy-cmd inline>bun create webjs@latest my-app</copy-cmd></p>
      </div>
    </section>

    ${ctaPanel({
      // "One command, then a prompt", not "Start building with AI". The old
      // title was the seventh agent mention on the page and the only one
      // carrying no information, and it landed right after the page's most
      // concrete section. This one describes the two steps the lede then
      // explains, so the install bar below reads as step one.
      //
      // It also avoids a dangling pronoun. "then tell it what to build" was
      // the first draft, and the only noun near that "it" is "one command",
      // so it briefly reads as instructing the command. The lede can use "it"
      // safely because it names the agent in the same sentence.
      // The two spaces inside "then a prompt" are NBSPs (U+00A0), which is the
      // whole mobile line-break fix. The title is a plain string in a text
      // hole, so there is no markup to hang a <br> or a responsive class off,
      // and at 390px the greedy fill broke it "One command, then a" / "prompt".
      // Gluing the second clause makes it one unwrappable unit, so the break
      // lands at the comma where the sense already breaks. Width-adaptive by
      // construction: nothing wraps at all above ~430px.
      title: 'One command, then a prompt',
      lede: 'Run the command below in your terminal, launch your AI coding agent from the app folder, and tell it what you would like to build.',
      primary: { href: DOCS_START_PATH, label: 'Get started' },
      // NOT a second docs link. This slot used to point at DOCS_PATH while the
      // primary pointed at DOCS_START_PATH, and /docs is a 308 to
      // /docs/getting-started, so both buttons resolved to the identical URL and
      // the secondary was dead weight. The pair now offers two different
      // actions, read it or watch it work, which is what a secondary is for.
      secondary: { href: GALLERY_URL, label: 'See it running', ext: true },
    })}

    </main>
  `;
}
