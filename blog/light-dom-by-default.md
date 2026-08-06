---
title: "Light DOM vs Shadow DOM: Why WebJs Defaults to Light DOM"
date: 2025-12-22T10:00:00+05:30
slug: light-dom-by-default
description: "Why WebJs keeps the light-DOM default for web components. Tailwind and global CSS cascade in, DOM queries work, accessibility behaves, and tests need no shadow-piercing helpers. Shadow DOM stays an opt-in."
tags: components, light-dom, shadow-dom, defaults, tailwind, ssr
author: Vivek
---

Drop a web component into your page, style it with your usual CSS, and sometimes those styles simply refuse to show up. The usual culprit is shadow DOM (an isolation boundary that seals a component's internals off from the rest of the page), which many component libraries wrap around your markup by default. WebJs goes the other way and defaults to light DOM (the component's rendered output living as ordinary page DOM, with no such boundary). Native web components default to light DOM too. If you write a custom element that does not call `this.attachShadow(...)`, there is no shadow root. The element's children are regular DOM. That is what the platform spec gives you out of the box.

The two libraries most developers and most AI training data treat as canonical for web components picked a different default. lit's [`LitElement` attaches a shadow root](https://lit.dev/docs/components/shadow-dom/) in its constructor unless you override `createRenderRoot()` to return `this`. [Microsoft's FAST automatically attaches a `ShadowRoot`](https://fast.design/docs/1.x/fast-element/working-with-shadow-dom/) and renders the template into it. Because these are the libraries most developers learn from, the perception has shifted: people assume shadow DOM is the web-components default. It is not. It is a library convention that the platform itself does not share.

For what it is worth, [Stencil's `@Component` decorator defaults to light DOM](https://stenciljs.com/docs/styling) (`shadow: false`); you opt into shadow by writing `@Component({ shadow: true })`. The `stencil generate` CLI scaffolds shadow-enabled components, which is where the "Stencil defaults to shadow" line you sometimes see comes from, but that is the scaffolder template, not the framework's default. WebJs sits in the same camp as Stencil's underlying default: light DOM unless you ask for shadow.

WebJs aligns with the platform default and treats light DOM as the everyday case. Every component renders in light DOM unless the class declares `static shadow = true`. The shadow path still works and is the right choice for a few specific situations. But the framework leans on what the platform itself defaults to.

This post is about why that choice is the right one, not just for spec-alignment, but for the practical things you do every day in an app.


# What "light DOM" means here

A web component in light DOM puts its rendered output directly into the host element's children. There is no shadow root. The component's nodes are just regular DOM under the custom element. Page-wide CSS cascades in. Page-wide queries see the nodes. The browser treats them like any other markup.

A web component in shadow DOM creates a shadow root and renders into it. The nodes are isolated. Page-wide CSS does not reach inside. `document.querySelector(...)` does not find the inner nodes. The browser draws a boundary that protects the component's internals.

Both are valid choices. The web platform supports both. The argument is about which one should be the default.


# Why light DOM is the right default

Six concrete benefits, ordered by how much each one matters in practice.


## 1. Tailwind classes apply

This is the load-bearing one for webjs. The framework defaults to Tailwind. Components author markup with Tailwind utilities. The utilities live in a global stylesheet. Light DOM means those utilities work as expected, no escape hatches required.

```ts
class Card extends WebComponent {
  render() {
    return html`
      <article class="rounded-lg border border-border p-4 bg-bg-elev">
        <h3 class="text-fg font-semibold mb-2">${this.title}</h3>
        <p class="text-fg-muted">${this.description}</p>
      </article>
    `;
  }
}
```

If `Card` were a shadow-DOM component, every one of those classes would silently do nothing. The shadow root does not inherit page styles. The agent or developer would have to either inject Tailwind into each shadow root, switch the component's styling story to CSS variables, or write `static styles = css\`...\`` and reinvent the design system inside the component. Each of those is friction that compounds across the codebase.

With light DOM as the default, the same components that get composed into pages share the same styling story as the rest of the app. There is no "the page uses Tailwind but the components do not" cognitive split.

A note before going further: **WebJs does not require Tailwind.** The scaffold defaults to Tailwind because it pairs well with the rest of the stack, but the framework itself is agnostic about how you write CSS. Vanilla stylesheets, CSS modules, BEM, plain hand-written CSS, a different utility framework, any of them work. The benefit in this section is general: any external CSS strategy you bring cascades into light-DOM components without escape hatches. Tailwind is the concrete example throughout this post because it is the scaffold default and the most-used styling story in WebJs apps. The argument is about light DOM, not about Tailwind specifically.


## 2. CSS stays cache-friendly

The shadow DOM cost that gets undercounted is the wire-bytes cost of `static styles = css\`...\``. Every shadow-DOM component carries its own stylesheet inline. If you have a `<my-button>` rendered fifty times on a page, the styles for it are still _one_ instance in memory (browsers dedupe identical adopted stylesheets), but the SERVER-RENDERED HTML for that page has the stylesheet serialized into the page's first response either inside the Declarative Shadow Root or as a hot path that needs the CSS to reach the client before the component upgrades.

With light DOM, the styles live in one external stylesheet (the scaffold's `tailwind.css`, or your own `app.css`, or whatever you write) that the browser caches once and reuses forever. New page navigations get the HTML, not the CSS. With shadow-DOM components, the inline styles ship per page.

For most apps this is a few KB. For component-heavy pages it adds up. The cache-friendly default is to put styles in one external stylesheet and let HTTP caching do its job.


## 3. DOM queries just work

`document.getElementById('foo')` finds the element. `document.querySelectorAll('.button')` returns every button on the page. `event.target.closest('form')` walks up through component boundaries. None of these need special handling.

In shadow DOM, every component creates a query barrier. You have to know which shadow root the element is in. You write helpers that do `composedPath()` walks or `getRootNode({ composed: true })` to pierce the boundary. Every query becomes a question of "did I cross a shadow root?"

For framework-internal queries this is manageable. For application code, it is friction. The light DOM default means a developer or an agent writes `document.getElementById('checkout-button')` and it works.


## 4. Accessibility behaves the way the spec assumes

The accessibility tree was specified before shadow DOM was a thing. Most ARIA patterns assume the elements they reference are reachable from the page's root. `aria-labelledby="title-id"` finds `#title-id` if it is in light DOM. If `#title-id` lives in a different shadow root, the reference is broken.

There are workarounds. The Cross-Root ARIA Reflection spec is in progress. Some frameworks ship helpers. But the path of least resistance is to keep the elements in light DOM, where the accessibility tree behaves the way every screen reader and every ARIA tutorial assumes.

For form elements specifically, this is even sharper. A `<input>` inside a shadow root does not associate with the surrounding `<form>` unless the host element implements the `formAssociated` protocol via `ElementInternals`. Light DOM inputs just submit. The agent writes `<form><my-input name="email"></my-input></form>` and the form data carries `email` without any custom internals work.


## 5. Tests do not need shadow-piercing helpers

Playwright, Puppeteer, Web Test Runner, and `node:test` + JSDOM all support shadow DOM, but every selector that crosses a shadow boundary needs special syntax. In Playwright you write `>>>` or `>> internal:shadow`. In Puppeteer you use `pierce/` selectors or chained `evaluateHandle`. In CSS, `::part()` and `::slotted()` are the only ways to style across the boundary.

With light DOM, the test selectors are the same selectors you write in the component. `await page.click('button.submit')` finds the submit button. No piercing pseudo-selectors. The test file looks like the component file. Agents writing tests do not have to maintain a mental model of "this part of the DOM is in a shadow root, so I need different selectors."

This compounds with `@webjsdev/ui`, the component library. Light-DOM components mean the registry's components are testable with the same selectors users write for their own pages.


## 6. SEO and indexing

Search engines have improved at handling JS-rendered content, but the fastest path to "this content appears in search results" is "this content appears in the HTML response." Light-DOM components render their content directly into the page's HTML. The crawler reads the post body, the navigation, the headlines, all in the initial response.

Shadow DOM content is also visible to modern crawlers (Googlebot processes Declarative Shadow DOM correctly), but the path is more involved. The crawler has to assemble the DSD template into a shadow root, then render. The historical record of crawler-DSD interaction is shorter and more variable across search engines.

I will be honest: I do not have data on whether light DOM ranks measurably better than shadow DOM with DSD on Google. The signal is probably small to none for Google specifically. But for the long tail of crawlers (smaller search engines, archival bots, social-card scrapers, RSS readers, link previewers), the light-DOM HTML is more reliably handled. If you are starting from "what is the safest default for content discoverability across the web," light DOM is the lower-variance answer.


# What about style scoping?

The argument for shadow DOM is usually scoping: your component's styles will not leak out, and outside styles will not leak in. This is a real benefit in two situations:

- You are building a third-party widget that embeds in pages you do not control. Shadow DOM is what protects the widget from the host page's CSS.
- You are integrating with a legacy app that has high CSS specificity battles already. Shadow DOM is a clean reset.

For most application code, this is not the problem you have. You control the page. You control the components. Your CSS is intentional. The "leakage" risk is mostly a thought experiment.

Tailwind sidesteps the scoping question entirely: utility classes are atomic, intentional, and unique by construction. There is nothing to leak. If you author components with Tailwind utilities, scoping is a non-issue. The same applies to other naming-discipline approaches like BEM or scoped class prefixes. When a light-DOM component does author vanilla CSS, the convention is to prefix every class selector with the component's own tag name, which makes it as unique as a utility class would be. That one is a discipline you keep rather than something tooling checks for you, which is one more reason Tailwind stays the lower-effort default.

WebJs's recommendation: use Tailwind (or your chosen styling story) in light DOM by default. If a specific component needs strict isolation (third-party embed, design-system component meant to drop into hostile pages), opt into shadow DOM for that one component:

```ts
class IsolatedWidget extends WebComponent {
  static shadow = true;
  static styles = css`
    :host { display: block; padding: 1rem; }
    .header { color: red; }
  `;
  render() { return html`<div class="header">Isolated</div>`; }
}
```

Both modes coexist on the same page without trouble.


# What about slots?

`<slot>` projection is sometimes described as "a shadow DOM feature." It is technically what the spec defines, but WebJs ships its own light-DOM `<slot>` runtime with full parity to the shadow-DOM semantics: named slots, default content, fallback, `assignedNodes()`, `slotchange` events, SSR-time projection. The whole story is in [Light-DOM slots with full shadow-DOM parity](/blog/light-dom-slots-with-full-parity).

This means choosing light DOM does not cost you slot projection. The agent can write:

```ts
class Card extends WebComponent {
  render() {
    return html`
      <article class="rounded-lg border p-4">
        <header><slot name="title"></slot></header>
        <div><slot></slot></div>
      </article>
    `;
  }
}
```

And it works in light DOM. Tailwind classes apply. The slotted children project correctly. The card's border styles cascade in from the global stylesheet.


# When shadow DOM is the right call

Three situations where WebJs recommends `static shadow = true`:

- **Third-party embeds.** A widget you ship for other people's sites. You cannot trust the host page's CSS, so you isolate.
- **Design-system primitives that must look identical regardless of host context.** A `<ui-button>` shipped as a standalone package, dropped into a Shopify theme or a WordPress site. Shadow DOM is the protection layer.
- **Components with heavy `static styles`.** If the component needs sophisticated internal styling that you do not want competing with Tailwind utilities, shadow DOM gives you a clean room.

For the rest, light DOM is the default and the recommendation.


# The summary

Light DOM as default trades style isolation for everything else:

- External CSS applies without escape hatches: Tailwind utilities, vanilla stylesheets, CSS modules, BEM, whatever you bring.
- That external stylesheet is cached once by the browser, not inlined per-component.
- `document.querySelector`, `closest`, and friends work without shadow-piercing.
- Accessibility (`aria-labelledby`, form association) works the way the spec assumes.
- Playwright / Puppeteer / Web Test Runner selectors work without pierce-prefixes.
- Search engines and crawlers see the content in the initial HTML response, with no DSD reassembly needed.

The cost is style scoping, which is usually not a problem in app code and is fully addressable for the cases where it is (Tailwind utilities by construction, BEM or class-prefix discipline for vanilla CSS, shadow opt-in for isolated widgets).

The shape WebJs settled on: light DOM by default, with Tailwind as the scaffold default but no framework-level requirement to use it. Shadow DOM is an opt-in for the specific cases that need it. Same `<slot>` semantics in both. The agent writes one style of component and the framework picks the right rendering mode based on the `static shadow` flag.

That is the everyday case for app code. The framework handles the rest.
