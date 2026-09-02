import { html } from '@webjsdev/core';
import '#components/copy-cmd.ts';
import { COMPONENT_SAMPLE, ACTION_SAMPLE, PAGE_SAMPLE } from '#lib/samples.ts';
import { BTN_PRIMARY, BTN_GHOST, INSTALL } from '#lib/design/recipes.ts';
import { DOCS_START_PATH, GH_URL, NEW_TAB, SAME_AS } from '#lib/links.ts';
import { faqJsonLd } from '#lib/utils/faq.ts';
import { highlight } from '#lib/utils/highlight.ts';

/**
 * /what-is-webjs
 *
 * The definitional page for the "what is webjs" query class. Where /why-webjs makes
 * the argument for the framework and /compare positions it against specific
 * alternatives, this page answers the flat question: what IS this thing.
 *
 * It exists because the query is contested. "WebJS" also names a dormant Java
 * web framework (last published 2013), a small client-side toolkit, and it is
 * the common short form of whatsapp-web.js. So the page leads with an
 * unambiguous one-sentence definition, then disambiguates the other projects by
 * name in a dedicated section. That section is the honest answer to a real
 * reader question and is what makes this page a better result than a stub that
 * only describes our own framework.
 *
 * SEO shape, deliberately:
 *  - exact-match <title>, <h1>, and URL slug for the target query
 *  - a definition in the first 160 characters, so the meta description and the
 *    opening paragraph both stand alone as an answer snippet
 *  - a visible FAQ that is the SAME source as the FAQPage JSON-LD (via
 *    lib/utils/faq.ts), because Google discounts schema not present on the page
 *  - SoftwareApplication + BreadcrumbList + FAQPage structured data
 *  - alternates.canonical, since this page is the one canonical definition
 *
 * Reuses the home page's design language (the shared lib/design/recipes.ts recipes, the terminal
 * "windows", the bento CARD) so the site reads as one system.
 */

const SITE_URL = 'https://webjs.dev';
const CANONICAL = `${SITE_URL}/what-is-webjs`;

const TITLE = 'What is WebJs?';
// Front-loaded so the first 160 characters answer the query on their own, which
// is what a SERP snippet and an AI answer engine both quote.
const DESCRIPTION =
  'WebJs is an AI-first full-stack JavaScript web framework built on web components. It renders on the server, ships no build step, and runs on Node 24+ or Bun. Pages are real HTML that work before any script loads.';

/**
 * The visible FAQ. Rendered into the page AND parsed into FAQPage JSON-LD from
 * this one array, so the structured data can never drift from what a reader
 * sees. Question wording tracks how the questions are actually typed, including
 * the disambiguation ones that bring the mixed-intent traffic.
 */
const FAQ = [
  {
    question: 'What is WebJs?',
    answer:
      'WebJs is an AI-first full-stack JavaScript web framework built on web components. It server-renders every page and component to real HTML, needs no build step or bundler, and runs on Node 24+ or Bun. The framework serves your source to the browser exactly as you wrote it, so the code you read is the code that runs.',
  },
  {
    question: 'What makes WebJs AI-first?',
    answer:
      'WebJs is designed so a coding agent can change one part of an app without reading all of it. File conventions are predictable, each server function lives in its own file, and the .server.ts extension marks the server boundary explicitly, so the relevant context for a change is small and easy to locate. Every app ships an AGENTS.md contract plus a cross-agent skill that Claude Code, Cursor, Copilot, Gemini, and opencode all read from one source. And because there is no build step, the framework itself sits as plain JavaScript with JSDoc in node_modules/@webjsdev of every app, so an agent reads the actual router, renderer, or serializer it is calling rather than a compiled bundle. That grounding in real source is what lets even smaller AI models produce quality WebJs code.',
  },
  {
    question: 'Is WebJs free to use?',
    answer:
      'Yes. WebJs is free and open source under the MIT license, developed in the open at github.com/webjsdev/webjs. There is no paid tier, no license key, and no hosted service you are required to buy.',
  },
  {
    question: 'Is WebJs the same as whatsapp-web.js?',
    answer:
      'No. whatsapp-web.js is an unofficial Node.js library for building WhatsApp clients and bots, often shortened to wwebjs. WebJs is an unrelated full-stack web framework for building websites and web applications.',
  },
  {
    question: 'Is WebJs the same as the older Java WebJS framework?',
    answer:
      'No. An earlier unrelated project called WebJS aimed to let Java developers build web applications, and it was last published in 2013. WebJs is a modern JavaScript and TypeScript framework, actively developed, with no connection to that project.',
  },
  {
    question: 'Does WebJs need a build step?',
    answer:
      'No. WebJs serves your source files directly as native ES modules. TypeScript is stripped at request time by the runtime, using Node 24+ built-in type stripping or amaro on Bun, so there is no bundler, no compile output, and no watch process to keep in sync. You edit a file and refresh.',
  },
  {
    question: 'Does a WebJs app work without JavaScript?',
    answer:
      'Yes, for everything that does not require interactivity. Pages and components are server-rendered to HTML, so content reads, links navigate, and forms submit with JavaScript disabled. Scripts are then layered on per interactive behaviour rather than per component, and a display-only component ships no JavaScript at all.',
  },
  {
    question: 'What can you build with WebJs?',
    answer:
      'Full-stack web applications with server-rendered pages, file-based routing, server actions, sessions, authentication, caching, rate limiting, WebSockets, and a database layer. It also runs backend-only as an HTTP and JSON API framework if you skip pages entirely.',
  },
  {
    question: 'Is WebJs tied to Tailwind and Drizzle?',
    answer:
      'No. A scaffolded app arrives wired to Tailwind for styling, Drizzle with SQLite for data, light DOM components, and design tokens, because an agent building your app should not have to stop and ask. Those are defaults rather than requirements. Bring a different ORM, a different database, or a different way of styling and the framework does not object, since none of the routing, rendering, or server-action machinery depends on any of them.',
  },
  {
    question: 'Does WebJs give you full-stack type safety?',
    answer:
      'Yes, and without a code generation step. A component imports a server action through an ordinary import, so the call site keeps that function\'s real argument and return types, and a database row carries its schema type from Drizzle through the action into the markup that renders it. Because types are stripped at request time rather than compiled, the types you read in the editor describe the code that actually runs.',
  },
  {
    question: 'How do you install WebJs?',
    answer:
      'Run npm create webjs@latest my-app to scaffold a full-stack application, then npm run dev to start it. The scaffold includes routing, a database layer, and a styled layout, so the app is production-shaped from the first command.',
  },
];

export function generateMetadata() {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: CANONICAL },
    openGraph: {
      type: 'article',
      title: TITLE,
      description: DESCRIPTION,
      url: CANONICAL,
      image: `${SITE_URL}/public/og.png`,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': 'WebJs, a full-stack JavaScript framework built on web components',
      'site_name': 'WebJs',
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      image: `${SITE_URL}/public/og.png`,
    },
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        // The same @id the home page's SoftwareApplication carries, so this
        // richer description merges into that node rather than standing up a
        // second software entity with the same name (#1100).
        '@id': `${SITE_URL}#software`,
        name: 'WebJs',
        alternateName: ['webjs', 'WebJS framework'],
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Node.js 24+, Bun',
        url: SITE_URL,
        description: DESCRIPTION,
        license: 'https://opensource.org/licenses/MIT',
        codeRepository: GH_URL,
        // This is the page that disambiguates the contested name, so it is the
        // one that most needs to say which properties are the same entity. The
        // list is shared with the home page's Organization node (#1100).
        sameAs: SAME_AS,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'WebJs', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: TITLE, item: CANONICAL },
        ],
      },
      faqJsonLd(FAQ),
    ],
  };
}

// Shared class strings, kept in lockstep with app/page.ts and app/why-webjs/page.ts
// so the three render as one design system.
const WIN = 'flex flex-col flex-1 m-0 min-w-0 max-w-full rounded-2xl overflow-hidden border border-border bg-bg-elev shadow-[var(--shadow)]';
const WINBAR = 'flex items-center gap-1.5 px-3.5 py-2.5 border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]';
const WINNAME = 'ml-2 font-mono font-medium text-xs leading-none text-fg-subtle';
const DOTS = html`<span class="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>`;
const CARD = 'p-6 bg-bg-elev hover:bg-[color-mix(in_oklch,var(--bg-elev)_92%,var(--fg))] transition-colors duration-200 flex flex-col h-full';
const H2 = 'font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance';
const PROSE = 'text-fg-muted text-base leading-[1.7] m-0';

// The capability inventory. Answers the implicit second half of the question,
// "and what does it actually give me", in concrete nouns rather than adjectives.
const CAPABILITIES = [
  {
    title: 'AI-first, one route at a time',
    body: 'Predictable file conventions and an explicit .server.ts boundary decide the shape of an app, so an agent edits one route without reading the whole app, and Build me an app is the whole prompt. Every app ships an AGENTS.md contract that Claude Code, Cursor, Copilot, Gemini, and opencode read from one source, and the framework itself is plain JavaScript with JSDoc in node_modules rather than a compiled bundle.',
  },
  {
    title: 'Web components, server-rendered',
    body: 'Components are standard custom elements. Every render() runs on the server, so the initial markup is in the HTTP response before any script loads. Light DOM is the default, so global CSS and Tailwind apply directly, and shadow DOM is one static field away when you want scoped styles.',
  },
  {
    title: 'File-based routing',
    body: 'A page.ts file is a route, a layout.ts wraps everything under it, and a route.ts is an HTTP handler. Dynamic segments, route groups, catch-alls, error boundaries, and loading states all follow the folder structure, so the URL map is the directory tree.',
  },
  {
    title: 'Server actions with real types',
    body: 'Export an async function from a .server.ts file and import it straight into a component. The import becomes a typed RPC call, so the argument and return types cross the boundary with it and a database row keeps its schema type the whole way into the markup, with nothing generated in between. The wire preserves Date, Map, Set, BigInt, Blob, File, FormData, and reference cycles, and the server source never reaches the browser.',
  },
  {
    title: 'Batteries included',
    body: 'Sessions, authentication, caching, rate limiting, file storage, and WebSockets ship in the box, sharing one pluggable store. In-memory by default, and a single setStore call moves all of them onto Redis.',
  },
  {
    title: 'TypeScript with nothing to compile',
    body: 'Write .ts files and run them. Types are stripped at request time by Node 24+ or by amaro on Bun, position-preserving and near-zero overhead, so what you read in the editor is what runs in the browser.',
  },
];

// Disambiguation. Several unrelated projects share the name, and a reader
// arriving from a search may want one of the others. Naming them plainly is
// both the useful answer and the reason a searcher trusts this page.
const OTHER_PROJECTS = [
  {
    name: 'whatsapp-web.js (wwebjs)',
    body: 'An unofficial Node.js library for building WhatsApp clients and bots. Commonly shortened to wwebjs, and unrelated to this framework.',
  },
  {
    name: 'WebJS for Java',
    body: 'An older framework aimed at letting Java developers build web applications without combining many technologies. Last published in 2013 and no longer active.',
  },
  {
    name: 'webJS toolkit',
    body: 'A small client-side JavaScript toolkit that compiles HTML templates into reusable JavaScript for dynamic page rendering. A browser library rather than a full-stack framework.',
  },
];

function codeWindow(title: string, sample: string, label: string) {
  return html`
    <figure class=${WIN}>
      <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>${title}</span></figcaption>
      <pre class="scroll-thin m-0 p-4 overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" role="region" tabindex="0" aria-label=${label}><code>${highlight(sample)}</code></pre>
    </figure>
  `;
}

export default function WhatIsWebJs() {
  return html`
    <main id="main" tabindex="-1" class="focus:outline-none">

      <section class="text-center px-6 pt-12 md:pt-20 lg:pt-28 pb-10 md:pb-16">
        <h1 class="font-display font-extrabold text-hero-h1 leading-[1.04] tracking-[-0.035em] mx-auto mt-2 mb-6 max-w-[14ch] text-balance">
          What is WebJs?
        </h1>
        <p class="text-hero-lede leading-[1.3] text-fg-muted max-w-[64rem] mx-auto mb-6 text-balance">
          <strong class="text-fg font-semibold">WebJs is an AI-first full-stack JavaScript web
          framework built on web components.</strong> It server-renders every page and component to
          real HTML, needs no build step or bundler, and runs on Node 24+ or Bun.
        </p>
        <p class="text-base leading-[1.7] text-fg-muted max-w-[56ch] mx-auto mb-8 text-pretty">
          You get production-ready architecture from your very first prompt, and none of it is
          hidden from your agent. The framework ships in node_modules as plain JavaScript, so
          an agent opens the router or the renderer it is calling instead of
          recalling an API from training data, and your app code is served to the browser
          exactly as written. Any model debugs the running app against the real source, with
          no single blessed model, on the web components and standard HTML every model
          already knows.
        </p>
        <div class="flex gap-3 justify-center flex-wrap mb-8">
          <a class=${BTN_PRIMARY} href=${DOCS_START_PATH}>
            Get started
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
          <a class=${BTN_GHOST} href="/why-webjs">Why WebJs exists</a>
        </div>
        <div class=${INSTALL}>
          <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
        </div>
      </section>

      <section class="py-16">
        <div class="max-w-6xl mx-auto px-6">
          <div class="max-w-3xl mx-auto mb-12 text-center">
            <h2 class=${H2}>What a WebJs app looks like</h2>
            <p class=${PROSE}>
              A component, a server action, and a page. These are ordinary files in your project,
              served as written. There is no compile step between what you see here and what the
              browser receives.
            </p>
          </div>
          <div class="grid grid-cols-1 wide:grid-cols-3 gap-4 items-stretch">
            <div class="flex flex-col min-w-0">
              <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">A component</p>
              ${codeWindow('components/like-button.ts', COMPONENT_SAMPLE, 'A WebJs web component with a signal')}
            </div>
            <div class="flex flex-col min-w-0">
              <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">A server action</p>
              ${codeWindow('actions/get-post.server.ts', ACTION_SAMPLE, 'A WebJs server action reading from the database')}
            </div>
            <div class="flex flex-col min-w-0">
              <p class="font-mono font-semibold text-xs leading-[1.4] tracking-widest uppercase text-fg-subtle mb-2.5 ml-1">A page</p>
              ${codeWindow('app/posts/[id]/page.ts', PAGE_SAMPLE, 'A WebJs page composing the action and the component')}
            </div>
          </div>
        </div>
      </section>

      <section class="py-16">
        <div class="max-w-6xl mx-auto px-6">
          <div class="max-w-3xl mx-auto mb-12 text-center">
            <h2 class=${H2}>What WebJs does for you</h2>
            <p class=${PROSE}>
              WebJs is a full framework rather than a rendering library, so routing, data, and the
              production concerns arrive together instead of as six decisions you make yourself.
            </p>
          </div>
          <div class="grid grid-cols-1 mid:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
            ${CAPABILITIES.map((c) => html`
              <div class=${CARD}>
                <h3 class="font-display font-bold text-base leading-[1.3] tracking-[-0.01em] m-0 mb-2 text-fg">${c.title}</h3>
                <p class="text-fg-muted text-sm leading-[1.65] m-0">${c.body}</p>
              </div>
            `)}
          </div>
        </div>
      </section>

      <section class="py-16">
        <div class="max-w-3xl mx-auto px-6">
          <div class="mb-10 text-center">
            <h2 class=${H2}>Other things called WebJS</h2>
            <p class=${PROSE}>
              The name is shared. If you arrived looking for one of these, they are not this project.
            </p>
          </div>
          <dl class="m-0 grid gap-4">
            ${OTHER_PROJECTS.map((p) => html`
              <div class="rounded-2xl border border-border bg-bg-elev p-5">
                <dt class="font-display font-bold text-base leading-[1.3] text-fg m-0 mb-1.5">${p.name}</dt>
                <dd class="text-fg-muted text-sm leading-[1.65] m-0 ml-0">${p.body}</dd>
              </div>
            `)}
          </dl>
        </div>
      </section>

      <section class="py-16">
        <div class="max-w-3xl mx-auto px-6">
          <div class="mb-10 text-center">
            <h2 class=${H2}>WebJs FAQ</h2>
          </div>
          <div class="grid gap-3">
            ${FAQ.map((item) => html`
              <details class="group rounded-2xl border border-border bg-bg-elev px-5 py-4">
                <summary class="cursor-pointer list-none font-display font-semibold text-base leading-[1.4] text-fg marker:content-none">
                  ${item.question}
                </summary>
                <p class="text-fg-muted text-sm leading-[1.7] mt-3 mb-0">${item.answer}</p>
              </details>
            `)}
          </div>
        </div>
      </section>

      <section class="py-16 pb-24">
        <div class="max-w-3xl mx-auto px-6 text-center">
          <h2 class=${H2}>Try it in one command</h2>
          <p class="${PROSE} max-w-[52ch] mx-auto mb-8">
            The scaffold gives you routing, a database layer, and a styled layout, so you start from a
            production-shaped app rather than an empty directory.
          </p>
          <div class="${INSTALL} mb-8">
            <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
          </div>
          <div class="flex gap-3 justify-center flex-wrap">
            <a class=${BTN_PRIMARY} href=${DOCS_START_PATH}>Read the docs</a>
            <a class=${BTN_GHOST} href=${GH_URL} target="_blank" rel="noopener noreferrer">View on GitHub${NEW_TAB}</a>
          </div>
          <p class="mt-14 pt-8 border-t border-border max-w-[52ch] mx-auto text-sm leading-[1.7] text-fg-subtle">
            Compare WebJs with <a class="text-fg-muted hover:text-accent underline underline-offset-2" href="/compare/webjs-vs-nextjs">Next.js</a>,
            <a class="text-fg-muted hover:text-accent underline underline-offset-2" href="/compare/webjs-vs-lit">Lit</a>, and
            <a class="text-fg-muted hover:text-accent underline underline-offset-2" href="/compare/webjs-vs-astro">Astro</a>, or read
            <a class="text-fg-muted hover:text-accent underline underline-offset-2" href="/articles">the explainers</a>.
          </p>
        </div>
      </section>

    </main>
  `;
}
