---
title: "Familiar on Purpose: What WebJs Invents and What It Refuses To"
date: 2026-07-16T10:00:00+05:30
slug: familiar-on-purpose-what-webjs-invents
description: "WebJs borrows file-based routing from Next.js, a component API shaped like Lit, and import maps from Rails, then diverges in exactly 24 documented places. Why an AI-first, no-build web components framework treats novelty as a cost, and what that buys a developer and an AI coding agent."
tags: web-standards, ai-first, framework-design, web-components, developer-experience
author: Vivek
---

The question I get most often about WebJs, usually phrased more politely than this, is what is actually mine.

It is a fair question. Routing is the Next.js app-router shape, `page.ts` and `layout.ts` and `[param]` and `(group)`, down to the folder names. The component API is Lit-shaped, `render()` returning an `html` template, the `ReactiveController` protocol, the directive set. Import maps with no bundler is the Rails 7 model. Navigation that swaps content in place instead of reloading is the shape Hotwire made ordinary. Point at almost any surface and I can tell you which good idea it came from.

So here is the answer, and it is not a defensive one. That is the design. Familiarity is the part I worked hardest on, and the places WebJs does go its own way are a short, closed, written-down list. Both halves are deliberate, and the reason they are deliberate is that inventing things is expensive in a way framework authors systematically underestimate.

# Novelty is a cost, and the author is not the one who pays it

Every new concept a framework introduces gets paid for exactly once by the person who designed it and then forever by everyone else. It is a page of documentation someone has to find. It is an hour of a new hire's first week. It is a Stack Overflow answer that does not exist yet. It is a pattern that looks like something the reader already knows and behaves differently, which is worse than a pattern that looks unfamiliar, because at least unfamiliar makes you read the docs.

Framework authors do not feel this cost. We feel the opposite one, the awkwardness of a borrowed abstraction that does not quite fit our internals, and we are the only people in the world for whom fixing that is free. So the incentive runs toward inventing, and the bill lands on strangers.

I decided early that WebJs would treat a new concept as something that has to be forced on it, not chosen. Not "is our version nicer" but "is there any way to do this with what people already know". If the answer is yes, we take the known thing even where a fresh design would be tidier.

That rule is why the borrowed list is long. It is also why the list of divergences is short enough to count.

# The surfaces I took, and where they came from

Briefly, because each of these has its own post and none of them needs re-arguing here.

Routing [copies the Next.js app-router conventions](/blog/file-based-routing) rather than improving on them, including the newer boundaries like nearest-wins `not-found` and the `forbidden()` and `unauthorized()` control-flow throws that [Next 16 parity](/blog/nextjs-16-file-routing-parity) brought over. The component runtime [mirrors Lit's public API](/blog/betting-on-lits-mental-model), the same lifecycle hook names and the same directive set, so Lit knowledge transfers even though the implementation underneath is WebJs's own. Dependencies arrive [through an import map served by jspm.io](/blog/no-build-via-jspm-io), which is the model Rails 7 shipped and got right. Optimistic UI [uses the same shape as React 19's useOptimistic](/blog/optimistic-ui-without-boilerplate) because that shape is good and a second spelling of it would help nobody.

Each of those teams did real work to arrive at those designs. Redesigning around them for the sake of having my own version would be a strange way to thank them, and a worse experience for anyone arriving from that stack.

# Twenty-four places where your reflexes misfire

The interesting number is the other one. WebJs ships a reference file whose entire job is to list the patterns that look right and are not. Right now it holds 24 entries, 11 for developers arriving from Next.js and 13 for developers arriving from Lit.

That is the complete divergence surface, at the level a person actually hits it. Not a philosophy, a list. You can read it in fifteen minutes and then write WebJs code the way you write the framework you already know, because every remaining reflex is correct.

A few of the entries, to give the shape of it:

- **`'use client'` does nothing.** There is no server/client component split, [no RSC render tree, and no Flight protocol](/blog/server-actions-without-react-server-components). The boundary in WebJs runs between kinds of file, not kinds of component.
- **Reactive properties are declared in a base-class factory**, `extends WebComponent({ count: Number })`, not with a `@property()` decorator or a `static properties` block. Each one becomes [a real accessor the constructor installs on the instance](/blog/building-on-javascript-not-around-it), which is why a class-field initializer silently replaces it and the re-renders stop.
- **Components render into [light DOM by default](/blog/light-dom-by-default)**, with shadow DOM one line away when you want it.
- **`fetch()` in a page is the wrong tool.** You call a server action, imported like a normal function, and the import becomes a typed RPC stub.
- **A browser global in a constructor or `render()` throws during SSR**, because SSR really does run those two and not the browser-only lifecycle hooks.

Read those five and a pattern shows up. Not one of them is a preference.

# Every one of them was forced

Take the reactive-property factory, the divergence people notice first because it is the most visible cosmetic difference from Lit.

Lit declares properties with a decorator. Decorators, in the TypeScript form that carries the metadata a framework needs, are not erasable syntax. WebJs has no build step, so types come off with Node's built-in stripper, which overwrites the type syntax with whitespace in place and refuses anything that is not pure erasure. A decorator that needs `emitDecoratorMetadata` cannot survive that, which means the decorator form is not available at any price, however much I might prefer the ergonomics.

So the choice was never "decorator or factory". It was "keep the no-build guarantee or keep the familiar spelling", and no-build is load-bearing for everything else, including the stack traces that point at your real line numbers and the `node_modules` source that reads like source. The factory is what the constraint left standing.

The others go the same way. Light DOM is the default because it is the *platform's* default, and a custom element that renders into light DOM is one that global CSS, Tailwind, `querySelector`, form association, and screen readers all treat as ordinary DOM. Not shipping an RSC split is not a gap, it is that WebJs does not have the problem the split solves, since components hydrate per element and pages never hydrate at all. The `.server.ts` boundary is a path-level fact the file router can enforce by refusing to serve the file, which an annotation inside a source file cannot be.

I am not claiming these are the only defensible answers. I am claiming each one traces back to a constraint rather than to taste, and that the trace is short enough to write in a paragraph. When someone asks why WebJs did something differently, there is an answer that is not "we liked ours better".

# The quiet divergence is the expensive one

A short list of differences is only useful if you find out you crossed one. Twenty-four documented gotchas do nothing for a developer who never opens the file, so each divergence needs to announce itself at the moment the old habit fires.

Write a `static properties` block from Lit muscle memory and the component throws immediately, with the migration in the message.

```
Counter: `static properties` is no longer supported. Declare reactive
properties via the factory instead: `class Counter extends WebComponent({
count: Number })`. Use the `prop()` helper for options (`prop(Number,
{ reflect: true })`) and set defaults in the constructor after `super()`.
See https://webjs.dev/docs/components.
```

It names your class, shows the replacement, and links the reference. The failure it replaces is the silent kind, which is what makes it worth the code. Reactivity that quietly stops working looks like your own bug, and you will go looking for it in your own code first.

The static counterpart is `webjs check`, which today runs 20 correctness rules and nothing else. The bar for a rule is deliberately narrow. It has to catch code that is wrong to ship, a crash or a security leak or a reactive prop that silently stops re-rendering or a type-strip failure, and never a matter of preference. Preferences live in prose where they can be argued with. So a class field replacing a reactive accessor is a rule, and so is a server-only import reaching a module that genuinely ships to the browser. Where you put your files is not.

The pattern is that the divergences are the things that carry enforcement. Familiar surfaces need no guardrail, since being right by default is what makes them familiar. The exceptions are where the throws and the check rules go.

# Writing for a reader who never got to learn the framework

There is a second audience for all of this, and it changed how I weigh the tradeoff.

An AI coding agent writing WebJs has effectively no WebJs in its training data. What it has is a great deal of Next.js, React, Lit, and Rails. When it writes a `page.ts` with a default-exported function taking `{ params }`, that is not knowledge of WebJs, it is a Next.js prior firing, and it happens to be exactly right. The borrowed surfaces are not merely convenient for agents. They are the only reason an agent can be productive in a framework it has never seen.

Which puts a sharp edge on the divergences, because a wrong prior fires with precisely the same confidence as a right one. An agent will write `'use client'` at the top of a component with total assurance. It has seen that pattern ten thousand times.

So the same three things that serve a person serve an agent, in the same order. Keep the divergence set small, so most priors land. Write it down in one file the agent can read, which is what the gotchas reference is for. Make each divergence fail loudly at the moment it is crossed, because a runtime throw with the fix in it is a correction an agent can act on in the next turn, while silent wrongness is a bug that ships.

None of that is AI-specific work. It is the same work that makes a framework learnable by a person on their first afternoon, which is the part I find genuinely reassuring about building this way. There is no tension to manage between the two audiences. [The plumbing that serves one](/blog/ai-first-is-plumbing) serves the other.

# Where copying would have been the wrong answer

To be clear that this is a judgment and not a rule I follow off a cliff, there are places I looked at a familiar pattern and did not take it.

The obvious one is CSRF protection. Every framework I learned from ships a token, a hidden form field, and a cookie to compare it against, and it works. WebJs [checks `Sec-Fetch-Site` instead](/blog/csrf-protection-without-tokens), because the browser now states on every request whether it came from your site, JavaScript cannot forge that, and building a token pipeline to rediscover a fact the browser already sends is work for its own sake. The familiar pattern was familiar because it predates the header, which is a good reason for it to exist and a bad reason to copy it.

That is the actual test. Not "has someone done this before" but "is the familiar version still the best available answer given what the platform does now". Most of the time it is, which is why most of WebJs looks like something you have seen. Sometimes the platform has moved and the muscle memory has not, and then the borrowed thing is the one that costs you.

# The judgment is the thing

A framework's identity is not a count of the concepts it invented. Plenty of frameworks with a great deal of original vocabulary are miserable to use, and their originality is the reason.

What is mine is the judgment about where to spend. A no-build runtime that serves the file you wrote. A component model that leans on the real object model instead of covering it. A server boundary the file router enforces at the path level. Display-only components whose JavaScript is not sent at all. Those choices are connected, they hold together, and they cost me the ability to borrow in a few specific places, so I did not borrow there and I wrote down exactly where.

Everywhere else, you already know how to use this. That is not a shortcut I took. It is the feature I worked hardest on.
