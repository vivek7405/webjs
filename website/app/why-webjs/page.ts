import { html } from '@webjsdev/core';
import '#components/copy-cmd.ts';
import { BTN_PRIMARY, BTN_GHOST, INSTALL} from '#lib/design/recipes.ts';
import { ctaPanel } from '#lib/ui/cta-panel.ts';
import { DOCS_START_PATH, GH_URL, NEW_TAB } from '#lib/links.ts';

/**
 * /why-webjs
 *
 * The developer pitch page. Where the home page shows the framework's shape
 * (progressive enhancement, the three-file stack, the weight stats), this page
 * makes the single argument that matters most for the AI era: an agent reads the
 * framework source it is calling, from the app's own node_modules at the version
 * installed there, so it needs no training data and no single blessed model to
 * build a WebJs app well. The claim is about LOCATION, not volume. Nothing reads
 * the whole framework (see the comment above DESCRIPTION in app/layout.ts for
 * the line counts), and the located version is the stronger claim anyway,
 * because it holds however large the framework grows.
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
    'WebJs is a full-stack JavaScript framework where Build me an app is the whole prompt. The architecture, the code, a real database, and a design system arrive without being specified, because the framework already made those calls rather than leaving them for your prompt to close. Nothing is hidden behind a build step either, so any AI model reads the framework source from node_modules and reasons about the whole stack. No training data required, no single blessed model.';
  return {
    title,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${origin}/why-webjs`,
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
const WIN = 'flex flex-col flex-1 m-0 min-w-0 max-w-full rounded-2xl overflow-hidden border border-border bg-bg-elev shadow-[var(--shadow)]';
const WINBAR = 'flex items-center gap-1.5 px-3.5 py-2.5 border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]';
const WINNAME = 'ml-2 font-mono font-medium text-xs leading-none text-fg-subtle';
const DOTS = html`<span class="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>`;
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
    body: 'An agent does not need to have seen WebJs before. It opens the file it is calling in node_modules, learns the real API from the code, and starts producing correct output. New model, same result, because the source is the documentation.',
  },
  {
    title: 'Standard HTML and JavaScript',
    body: 'WebJs is built on web components, custom elements, SSR, and forms. Every model, small or large, is already trained on the platform primitives, so the muscle memory transfers instead of fighting a bespoke abstraction.',
  },
];

// What comes back from the one-sentence prompt. These are the things the
// prompt would otherwise have had to specify, so each must stay a genuine
// DEFAULT of the framework or of what `webjs create` scaffolds. If one ever
// becomes something the prompt has to request, the section's claim is gone.
// Keep the count EVEN: the grid is two columns at xs and up, so an odd entry
// leaves an empty cell painted in the grid's border colour.
const ARRIVES = [
  {
    title: 'Architecture',
    body: 'Where a page lives, where a form submission is handled, and which code is allowed to touch the server are settled by the framework, not improvised per app. The result comes out in the shape a reviewer expects.',
  },
  {
    title: 'Code',
    body: 'Server-rendered pages that work before any script loads, and no build step in between. Running webjs check catches what is outright wrong before it ships, so a mistake surfaces as a failing command rather than as a bug a reader has to find.',
  },
  {
    title: 'Type safety, end to end',
    body: 'Types run the whole way through. A component importing a server function keeps that function\'s argument and return types at the call site, and a database row carries its schema type into the markup that renders it, with no code generation anywhere in between. An agent has no reason to reach for any.',
  },
  {
    title: 'Database',
    body: 'A scaffolded app is wired to a real database with a schema and migrations from the first command, so an agent reaches for that rather than a list of items living in the code. Swap the database later if you want a different one.',
  },
  {
    title: 'Design system',
    body: 'A palette and a type scale ship as design tokens rather than values scattered through components, so every screen the app grows shares them and restyling the whole thing means editing the tokens, not hunting through the markup.',
  },
  {
    title: 'Agent skills',
    body: 'A scaffolded app ships a skill its coding agent reads on demand, covering the design system, the modules architecture, and the rest of the conventions. One source, understood by Claude Code, Cursor, Copilot, and opencode alike, so the agent looks up how this app is meant to be built instead of importing habits from another framework.',
  },
];

export default function Why() {
  return html`
    <main id="main" tabindex="-1" class="focus:outline-none">

    <section class="text-center px-6 pt-12 md:pt-20 lg:pt-28 pb-10 md:pb-16">
      <h1 class="font-display font-extrabold text-hero-h1 leading-[1.04] tracking-[-0.035em] mx-auto mt-2 mb-4 max-w-[16ch] text-balance">
        The framework your AI agent already understands
      </h1>
      <p class="text-hero-lede leading-[1.3] text-fg-muted max-w-[64rem] mx-auto mb-8 text-balance">
        WebJs is a full-stack JavaScript framework with no build step, so
        nothing is hidden from your agent. The framework ships in node_modules as
        plain JavaScript, so an agent opens the file it is calling instead of
        recalling an API from training data, and your app code is served to the
        browser exactly as written. Any model debugs the running app against the
        real source, on the web components and standard HTML it already knows.
      </p>
      <div class="flex gap-3 justify-center flex-wrap mb-8">
        <a class=${BTN_PRIMARY} href=${DOCS_START_PATH}>
          Get started
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </a>
        <a class=${BTN_GHOST} href="/compare">See how it compares</a>
      </div>
      <div class=${INSTALL}>
        <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Nothing is hidden behind a build step</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0">
            No build step means two things, and both help your agent. The
            framework itself sits in node_modules as plain JavaScript with JSDoc,
            so an agent opens the file it needs at the version you installed,
            rather than recalling an API from training data. And your own
            app code is served to the browser exactly as written, so the agent
            debugs the running app against the real source, never a bundled or
            minified artifact.
          </p>
        </div>
        <div class="grid grid-cols-1 wide:grid-cols-2 gap-4 items-stretch max-w-3xl mx-auto">
          <div class="flex flex-col min-w-0">
            <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">The framework, readable in node_modules</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>terminal</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="Listing and grepping the framework source in node_modules"><code><span class="text-accent">$</span> ls node_modules/@webjsdev/core/src
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
            <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">Your app code, served to the browser as written</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>terminal</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="Fetching an app module served unbundled"><code><span class="text-accent">$</span> curl localhost:5001/components/counter.ts
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
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Four reasons the loop just works</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0">Every one of these falls out of a single decision: no build step, on web standards.</p>
        </div>
        <div class="grid gap-px overflow-hidden rounded-2xl border border-border bg-border grid-cols-1 xs:grid-cols-2 shadow-[var(--shadow-sm)]">
          ${REASONS.map(r => html`
            <div class="${CARD}">
              <h3 class="font-display font-bold text-lg leading-[1.3] tracking-[-0.02em] mt-0 mb-2">${r.title}</h3>
              <p class="m-0 text-sm leading-[1.65] text-fg-muted">${r.body}</p>
            </div>
          `)}
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">The prompt does not have to carry the architecture</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0">
            Most frameworks leave the big decisions open, and that flexibility
            is the point of them. But an open decision has to be closed by
            somebody, and when an agent is writing the code, that somebody is
            whoever wrote the prompt. So the request grows an appendix of
            technical instructions, and every one of them is a thing you had to
            know to ask for. WebJs has already made those calls, so the request
            stays the request.
          </p>
        </div>
        <div class="grid grid-cols-1 wide:grid-cols-2 gap-4 items-stretch max-w-3xl mx-auto mb-12">
          <div class="flex flex-col min-w-0">
            <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">Where the decisions are still open</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>prompt</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="A prompt that has to specify the architecture as well as the app"><code><span class="text-accent">&gt;</span> Build me a table booking app

<span class="text-fg-subtle">  and put the data in a real database,</span>
<span class="text-fg-subtle">  use a design system, and write</span>
<span class="text-fg-subtle">  production ready code and architecture</span></code></pre>
            </figure>
          </div>
          <div class="flex flex-col min-w-0">
            <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">Where they are already made</p>
            <figure class=${WIN}>
              <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>prompt</span></figcaption>
              <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label="The same request on WebJs, with no architecture appended"><code><span class="text-accent">&gt;</span> Build me a table booking app

<span class="text-fg-subtle">  # that is the whole prompt. the rest</span>
<span class="text-fg-subtle">  # is not left to the model to guess,</span>
<span class="text-fg-subtle">  # so it is not yours to specify.</span></code></pre>
            </figure>
          </div>
        </div>
        <div class="max-w-3xl mx-auto mb-8 text-center">
          <p class="text-fg-muted text-base leading-[1.6] m-0">
            Both prompts should produce something you can put in front of
            customers. Only one of them made that your job to spell out.
          </p>
        </div>
        <div class="grid gap-px overflow-hidden rounded-2xl border border-border bg-border grid-cols-1 xs:grid-cols-2 shadow-[var(--shadow-sm)] max-w-3xl mx-auto">
          ${ARRIVES.map(a => html`
            <div class="${CARD}">
              <h3 class="font-display font-bold text-lg leading-[1.3] tracking-[-0.02em] mt-0 mb-2">${a.title}</h3>
              <p class="m-0 text-sm leading-[1.65] text-fg-muted">${a.body}</p>
            </div>
          `)}
        </div>
        <div class="max-w-3xl mx-auto mt-8 text-center">
          <p class="text-fg-muted text-base leading-[1.6] m-0">
            Opinionated is the point, and none of it is a cage. Light DOM
            components, Tailwind, and Drizzle on SQLite are what a scaffolded app
            starts with, because something has to be chosen and leaving it open
            is what pushed the decision into your prompt. Reach for a different
            ORM, a different database, or a different way of styling and the
            framework does not object. What you are opting out of is a default,
            never a dependency the rest of it is built on.
          </p>
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Experiment with any model, freely</h2>
          <p class="text-fg-muted text-base leading-[1.6] m-0 mb-4">
            Because the framework itself is the context, you are not locked to
            the one model that happened to memorize a given API. Point a large
            model or a small one at a WebJs project and it fits the source into
            context and gets to work. Switch models between tasks and the output
            stays reliable, because they are all reading the same readable code.
          </p>
          <p class="text-fg-muted text-base leading-[1.6] m-0 mb-4">
            That shows up in the quality of what comes back, not only in whether
            a model can participate. Routing, the server boundary, and the file
            layout are settled by convention, and the palette lives in design
            tokens the root layout sets once, so a smaller model is filling
            those in rather than inventing them. Taste is still yours to
            direct, and you still read what an agent hands you. What you stop
            doing is re-deciding the shape of the app every time you switch.
          </p>
          <p class="text-fg-muted text-base leading-[1.6] m-0">
            Human developers get the same deal. There is no hidden compiler
            output to reverse engineer when something breaks. You open the file,
            read the JavaScript, and see exactly what ran.
          </p>
        </div>
      </div>
    </section>

    ${ctaPanel({
      title: 'Point your agent at WebJs',
      lede: 'Scaffold a full-stack app in one command, then let any model read the source and build. Pages, an API, components, and a database, all on web standards.',
      primary: { href: DOCS_START_PATH, label: 'Get started' },
      secondary: { href: GH_URL, label: 'View on GitHub', ext: true },
    })}

    </main>
  `;
}
