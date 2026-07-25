import { html } from '@webjsdev/core';
import '#components/copy-cmd.ts';
import { DOCS_URL, GH_URL, EXAMPLE_BLOG_URL, NEW_TAB } from '#lib/links.ts';

/**
 * /why
 *
 * The developer pitch page. Where the home page shows the framework's shape
 * (progressive enhancement, the three-file stack, the weight stats), this page
 * makes the single argument that matters most for the AI era: an agent can read
 * the whole framework, so it needs no training data and no single blessed model
 * to build a WebJs app well.
 *
 * It deliberately reuses the home page's design language (the KICKER label, the
 * section rhythm, the terminal "windows", the bento grid, and the closing CTA
 * card) so the site reads as one system. The prose stays honest: it sells the
 * capability on its own terms, never by talking down the alternatives.
 */

export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og-why.png`;
  const title = 'Why WebJs - The Framework Your AI Agent Already Understands';
  const description =
    'WebJs is a full-stack JavaScript framework that serves the framework source and your app code exactly as written, so any AI model can read the whole stack from node_modules, reason about it, and debug it. No training data required, no single blessed model. Built on the web components, HTML, and JavaScript every model already knows.';
  return {
    title,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${origin}/why`,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': 'Why WebJs, the framework your AI agent already understands',
      'site_name': 'WebJs',
    },
    twitter: { card: 'summary_large_image', title, description, image },
  };
}

// Shared class strings, kept in lockstep with app/page.ts so the two pages
// render as one design system.
const KICKER = 'inline-flex flex-wrap justify-center gap-[10px] font-mono font-semibold text-[12px] leading-[1.4] tracking-[0.18em] uppercase text-[var(--accent-text)]';
const BTN = 'inline-flex items-center gap-2 px-[22px] py-[13px] rounded-full font-semibold text-[15px] leading-none no-underline border cursor-pointer transition-all duration-[140ms]';
const INSTALL = 'flex items-center gap-2 w-fit max-w-full mx-auto px-[18px] py-[14px] text-left font-mono text-sm leading-[1.6] text-fg-muted rounded-2xl border border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_70%,transparent)] backdrop-blur-sm shadow-[var(--shadow-sm)]';
const WIN = 'flex flex-col flex-1 m-0 min-w-0 max-w-full rounded-2xl overflow-hidden border border-border bg-bg-elev shadow-[var(--shadow)]';
const WINBAR = 'flex items-center gap-[7px] px-[14px] py-[10px] border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]';
const WINNAME = 'ml-2 font-mono font-medium text-[12px] leading-none text-fg-subtle';
const DOTS = html`<span class="w-[11px] h-[11px] rounded-full bg-[#ff5f57]"></span><span class="w-[11px] h-[11px] rounded-full bg-[#febc2e]"></span><span class="w-[11px] h-[11px] rounded-full bg-[#28c840]"></span>`;
const CARD = 'p-6 bg-bg-elev hover:bg-[color-mix(in_oklch,var(--bg-elev)_92%,var(--fg))] transition-colors duration-200 flex flex-col h-full';

// The four reasons an agent builds WebJs apps well, rendered as a bento grid
// matching the "Why webjs" cells on the home page.
const REASONS = [
  {
    title: 'What you write is what runs',
    body: 'No build, no bundler, no minifier. Source files are served as native ES modules, so the code your agent reads on disk is byte for byte the code running in the browser. It debugs against reality, never a compiled or source-mapped artifact.',
  },
  {
    title: 'The whole stack is a grep away',
    body: 'The framework ships as plain JavaScript with JSDoc under node_modules. An agent can open @webjsdev/core, follow SSR into @webjsdev/server, and trace a bug end to end without leaving the repo. The answer is always in the working tree.',
  },
  {
    title: 'No training data required',
    body: 'An agent does not need to have seen WebJs before. It fits the framework source into its context window, learns the real API from the code, and starts producing correct output. New model, same result, because the source is the documentation.',
  },
  {
    title: 'Standard HTML and JavaScript',
    body: 'WebJs is built on web components, custom elements, SSR, and forms. Every model, small or large, is already trained on the platform primitives, so the muscle memory transfers instead of fighting a bespoke abstraction.',
  },
];

export default function Why() {
  return html`
    <main id="main" tabindex="-1" class="focus:outline-none">

    <section class="text-center px-6 pt-[clamp(48px,7vw,96px)] pb-10 md:pb-16">
      <div class=${KICKER}>Built for the AI era</div>
      <h1 class="font-display font-extrabold text-display leading-[1.04] tracking-[-0.035em] mx-auto mt-4 mb-4 max-w-[16ch] text-balance">
        The framework your AI agent already understands
      </h1>
      <p class="text-lede leading-[1.6] text-fg-muted max-w-[56ch] mx-auto mb-8 text-pretty">
        WebJs is a full-stack JavaScript framework with no build step, so
        nothing is hidden from your agent. The framework ships in node_modules as
        plain JavaScript it can read end to end, and your app code is served to
        the browser exactly as written. Any model reasons about the whole stack
        and debugs it, with no training data required and no single blessed
        model, on the web components and standard HTML every model already knows.
      </p>
      <div class="flex gap-3 justify-center flex-wrap mb-8">
        <a class="${BTN} bg-accent text-accent-fg border-transparent shadow-[var(--shadow-glow)] hover:bg-accent-hover hover:-translate-y-0.5" href=${DOCS_URL + '/docs/getting-started'} target="_blank" rel="noopener noreferrer">
          Get started
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>${NEW_TAB}
        </a>
        <a class="${BTN} text-fg border-border-strong bg-[color-mix(in_oklch,var(--color-bg-elev)_60%,transparent)] hover:border-fg-muted hover:-translate-y-0.5" href="/compare">See how it compares</a>
      </div>
      <div class=${INSTALL}>
        <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-[1080px] mx-auto px-6">
        <div class="max-w-[720px] mx-auto mb-12 text-center">
          <div class=${KICKER}>Read the source, not the training set</div>
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Nothing is hidden behind a build step</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">
            No build step means two things, and both help your agent. The
            framework itself sits in node_modules as plain JavaScript with JSDoc,
            so an agent reads it end to end and fits it into context. And your own
            app code is served to the browser exactly as written, so the agent
            debugs the running app against the real source, never a bundled or
            minified artifact.
          </p>
        </div>
        <div class="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4 items-stretch max-w-[900px] mx-auto">
          <div class="flex flex-col min-w-0">
            <p class="font-mono font-semibold text-[11px] leading-[1.4] tracking-[0.12em] uppercase text-fg-subtle mb-[10px] ml-1">The framework, readable in node_modules</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>terminal</span></figcaption>
              <pre class="scroll-thin m-0 p-[18px] overflow-x-auto font-mono text-[13px] leading-[1.7] [tab-size:2] flex-1" tabindex="0" aria-label="Listing and grepping the framework source in node_modules"><code><span class="text-accent">$</span> ls node_modules/@webjsdev/core/src
component.js    html.js         render-client.js
css.js          directives.js   render-server.js
serialize.js    router-client.js

<span class="text-accent">$</span> grep -rn "renderToString" node_modules/@webjsdev
core/src/render-server.js: export async function renderToString(
server/src/ssr.js: const html = await renderToString(tree)
<span class="text-fg-subtle"># plain .js with JSDoc. the agent greps the</span>
<span class="text-fg-subtle"># framework source straight from node_modules.</span></code></pre>
            </figure>
          </div>
          <div class="flex flex-col min-w-0">
            <p class="font-mono font-semibold text-[11px] leading-[1.4] tracking-[0.12em] uppercase text-fg-subtle mb-[10px] ml-1">Your app code, served to the browser as written</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>terminal</span></figcaption>
              <pre class="scroll-thin m-0 p-[18px] overflow-x-auto font-mono text-[13px] leading-[1.7] [tab-size:2] flex-1" tabindex="0" aria-label="Fetching an app module served unbundled"><code><span class="text-accent">$</span> curl localhost:5001/components/counter.ts
import { WebComponent } from '@webjsdev/core';

class Counter extends WebComponent({ count: Number }) {
  increment() { this.count++; }
}
Counter.register('counter');
<span class="text-fg-subtle"># your source, served unbundled. what the</span>
<span class="text-fg-subtle"># agent wrote is what the browser fetched.</span></code></pre>
            </figure>
          </div>
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-[1080px] mx-auto px-6">
        <div class="max-w-[720px] mx-auto mb-12 text-center">
          <div class=${KICKER}>Why agents thrive here</div>
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Four reasons the loop just works</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">Every one of these falls out of a single decision: no build step, on web standards.</p>
        </div>
        <div class="grid gap-px overflow-hidden rounded-2xl border border-border bg-border grid-cols-1 min-[560px]:grid-cols-2 shadow-[var(--shadow-sm)]">
          ${REASONS.map(r => html`
            <div class="${CARD}">
              <h3 class="font-display font-bold text-[1.1rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">${r.title}</h3>
              <p class="m-0 text-sm leading-[1.65] text-fg-muted">${r.body}</p>
            </div>
          `)}
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-[1080px] mx-auto px-6">
        <div class="max-w-[760px] mx-auto text-center">
          <div class=${KICKER}>Model-agnostic by construction</div>
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Experiment with any model, freely</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0 mb-4">
            Because the framework itself is the context, you are not locked to
            the one model that happened to memorize a given API. Point a large
            model or a small one at a WebJs project and it fits the source into
            context and gets to work. Switch models between tasks and the output
            stays reliable, because they are all reading the same readable code.
          </p>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">
            Human developers get the same deal. There is no hidden compiler
            output to reverse engineer when something breaks. You open the file,
            read the JavaScript, and see exactly what ran.
          </p>
        </div>
      </div>
    </section>

    <section class="py-16 text-center" id="get-started">
      <div class="max-w-[1080px] mx-auto px-6">
        <div class="max-w-[760px] mx-auto p-[clamp(32px,5vw,64px)] rounded-[22px] border border-border-strong bg-[color-mix(in_oklch,var(--accent-live)_7%,var(--color-bg-elev))] shadow-[var(--shadow-glow)]">
          <h2 class="font-display font-extrabold text-h2 leading-[1.1] tracking-[-0.03em] mt-0 mb-3">Point your agent at WebJs</h2>
          <p class="text-fg-muted mx-auto mb-8 max-w-[48ch]">Scaffold a full-stack app in one command, then let any model read the source and build. Pages, an API, components, and a database, all on web standards.</p>
          <div class=${INSTALL}>
            <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
          </div>
          <div class="flex gap-3 justify-center flex-wrap mt-7">
            <a class="${BTN} bg-accent text-accent-fg border-transparent shadow-[var(--shadow-glow)] hover:bg-accent-hover hover:-translate-y-0.5" href=${DOCS_URL + '/docs/getting-started'} target="_blank" rel="noopener noreferrer">
              Get started
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>${NEW_TAB}
            </a>
            <a class="${BTN} text-fg border-border-strong bg-[color-mix(in_oklch,var(--color-bg-elev)_60%,transparent)] hover:border-fg-muted hover:-translate-y-0.5" href=${EXAMPLE_BLOG_URL} target="_blank" rel="noopener noreferrer">See a live app${NEW_TAB}</a>
          </div>
        </div>
      </div>
    </section>

    </main>
  `;
}
