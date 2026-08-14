---
title: "Accessible Web Components Out of the Box"
date: 2026-06-20T10:00:00+05:30
slug: accessible-web-components-by-default
description: "How @webjsdev/ui ships accessible web components by default, with keyboard navigation, screen-reader labels, and focus management wired in from the start."
tags: accessibility, a11y, web-components, ui, wcag
author: Vivek
---

Here is a thing most tutorials skip. A button that only works when you click it with a mouse is broken for a lot of people. Someone navigating with a keyboard cannot reach it. Someone using a screen reader (software that reads the page aloud for blind and low-vision users) hears nothing useful if the button has no label. That whole area of making a site usable by everyone, not just people with a mouse and good eyesight, is called accessibility, or "a11y" for short (the 11 is the number of letters between the a and the y).

The problem is that accessibility almost always gets bolted on late. You build the feature, ship it, and then someone files a bug that says the dropdown cannot be operated with a keyboard. Now you are retrofitting ARIA attributes, focus management, and roving tabindex into code that was written without any of them in mind. Retrofitting is painful because accessibility is not one attribute you sprinkle on at the end. It is a set of relationships (this control names that panel, arrow keys move between these items, focus returns here when the dialog closes) that are far easier to build in from the start than to reverse-engineer later.

So WebJs starts from accessible defaults. That is the whole pitch of this post.


# The component library, and how you get it

WebJs ships a component library called `@webjsdev/ui`. You pull components into your app from the CLI:

```sh
webjs ui init                       # one-time setup in your project
webjs ui add button card dialog     # copy those components into your repo
webjs ui list                       # see everything available
webjs ui view tabs                  # print a component's source before adding it
```

The components are source-copied into your project, so you own the files. There is no opaque dependency you cannot read or edit. That matters for accessibility specifically, because when you can read the component, you can see exactly what accessible behaviour it already handles.

The library is split into two tiers, and the split is the key to the whole design.


# Tier 1, class helpers on real native elements

The first tier is plain functions that return Tailwind class strings. `buttonClass()`, `cardClass()`, `inputClass()`, `labelClass()`, `alertClass()`, and friends. You spread them onto native HTML elements:

```ts
import { buttonClass } from '#components/ui/button.ts';

html`<button class=${buttonClass({ variant: 'outline' })}>Save</button>`;
```

That is a real `<button>`, not a wrapper. It participates in form submission, keyboard activation (Enter and Space work because the browser gives you that for a native button), the accessibility tree, and devtools as itself. WebJs components render in light DOM by default (the component's markup goes straight into the page, no shadow root), which is what lets the accessibility tree behave the way the spec assumes. I wrote about that choice in [Light DOM by default](/blog/light-dom-by-default).

Because a class helper returns only classes, the semantic markup is yours to write. So each helper carries an `A11y (required for accessible output)` block in its JSDoc that tells you precisely what to add. The icon-only button JSDoc says it must carry an `aria-label` (a screen reader has no text to read otherwise). The alert helper says to put `role="alert"` for an urgent message or `role="status"` for a polite one. Pagination says to wrap the list in a labelled `<nav>` and set `aria-current="page"` on the active link. Table headers need `scope`, an avatar image needs `alt`. Follow the block and the markup is fully accessible. The contract is written down right where you (or an AI agent) are reading the code.


# Tier 2, stateful custom elements that wire their own ARIA

The second tier is for the behaviour the browser still does not give you for free. Hover-with-delay tooltips, roving-focus keyboard navigation for menus and tabs, a toast queue that stacks and dismisses. These ship as custom elements (`<ui-dialog>`, `<ui-tabs>`, `<ui-tooltip>`, `<ui-dropdown-menu>`, `<ui-sonner>`, and more).

These are accessible out of the box. You do not hand-add ARIA to them, they wire their own. Look at what you write versus what you get:

```ts
// What you author. No aria-* anywhere.
html`
  <ui-tabs value="account">
    <ui-tabs-list>
      <ui-tabs-trigger value="account">Account</ui-tabs-trigger>
      <ui-tabs-trigger value="password">Password</ui-tabs-trigger>
    </ui-tabs-list>
    <ui-tabs-content value="account">...</ui-tabs-content>
    <ui-tabs-content value="password">...</ui-tabs-content>
  </ui-tabs>
`;
```

The rendered output carries `role="tablist"`, `role="tab"` with `aria-selected` and `aria-controls`, `role="tabpanel"` with `aria-labelledby`, roving `tabindex`, and Arrow-key navigation, none of which you had to type. I read the actual source rather than trust a README, so here is what is genuinely there.

`<ui-tabs>` follows the WAI-ARIA Authoring Practices tabs pattern (the source links the spec URL directly). The list gets `role="tablist"` with `aria-orientation`, each trigger is a native `<button role="tab">` with `aria-selected` and `aria-controls` pointing at its panel, and each panel gets `role="tabpanel"` with `aria-labelledby` pointing back at its trigger. Focus is roving (the active trigger has `tabindex="0"`, the rest `-1`) and Arrow keys, Home, and End move between tabs. An inactive panel is marked `hidden` and `inert`, so it drops out of the tab order and the accessibility tree entirely.

`<ui-dialog>` is a thin decorator over the native `<dialog>` element's `showModal()`. That means the focus trap, Escape-to-close, the backdrop, and background-inert all come from the platform rather than from hand-rolled JS that tends to have edge-case bugs. On open it names itself from your title and description via `aria-labelledby` and `aria-describedby`, puts `role="dialog"` on the native `<dialog>` itself so exactly one dialog node is exposed rather than a role nested inside the element's implicit one, and gives the auto-injected close button an `aria-label="Close"`. There is no `aria-modal`, because a dialog opened with `showModal()` is already exposed as modal by the platform.

The rest follow the same discipline. The dropdown menu declares `aria-haspopup="menu"`, uses `role="menu"` and `role="menuitem"` with roving focus and `aria-disabled`. The tooltip wires `aria-describedby` from the trigger to the tip text. The toaster (`<ui-sonner>`) is a polite live region, so new toasts get announced, and an error toast additionally carries `role="alert"`. An ordinary toast carries no role of its own, so it resolves under exactly one live region rather than a second one nested inside the viewport. Across the set, interactive elements carry `focus-visible` ring styles so keyboard users can see where focus is.


# The part aimed at AI agents

WebJs is built to be edited by AI agents, and accessibility is exactly the kind of thing an agent breaks by accident. It refactors a component, moves some markup, and quietly drops the `aria-controls` link or the roving tabindex. The feature still looks fine. It is just no longer usable with a keyboard, and nobody notices until a real user hits it.

So the accessibility expectations are encoded where the agent reads them. The tier-1 `A11y (required for accessible output)` JSDoc blocks are a contract in prose that sits next to the function. The tier-2 elements keep their ARIA wiring in the component source the agent copies into the repo, with comments explaining why each piece exists (why the panel is `inert`, why the dialog resolves its labels at open time). An agent editing the component reads the contract first, so its edits preserve the behaviour instead of silently regressing it. Human reviewers get the same benefit.

There is one more agent-friendly detail. The variant names, sizes, and data-attribute conventions mirror shadcn/ui. An agent's existing knowledge of shadcn maps directly onto these components, so it reaches for the right API on the first try.


# What the defaults do and do not cover

Accessible out of the box is a floor, not a certification. The library does not come with a WCAG conformance grade (WCAG, the Web Content Accessibility Guidelines, is the standard that defines web accessibility, with graded levels A, AA, and AAA), and no component library can earn that grade for you. What the defaults give you is concrete: keyboard navigation, screen-reader labels, and focus management, with the tier-2 elements following the published ARIA Authoring Practices patterns. The rest is still your app's job, meaning real content, meaningful labels, sensible color contrast, and testing with a keyboard and a screen reader. Starting from these defaults means you begin well above blank instead of retrofitting accessibility after the fact.


Accessibility is usable-with-a-keyboard-and-a-screen-reader, not just usable-with-a-mouse, and it is far cheaper to build in than to bolt on. WebJs ships `@webjsdev/ui` with that built in. Tier-1 class helpers hand you native elements plus an exact checklist of the ARIA to add, and tier-2 custom elements wire their own keyboard navigation, screen-reader labels, and focus management out of the box. Because the components are light DOM and source-copied into your repo, both you and any AI agent can read the accessibility contract and keep it intact through every edit. Run `webjs ui add` and you start from an accessible floor instead of a retrofit.
