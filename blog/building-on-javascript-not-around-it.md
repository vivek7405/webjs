---
title: "Building on JavaScript, Not Around It: Modules, Prototypes, and Types in WebJs"
date: 2026-07-10T10:00:00+05:30
slug: building-on-javascript-not-around-it
description: "Most frameworks ask you to forget JavaScript and learn their abstractions. WebJs bets the opposite: native ES modules, real prototype-based classes, and a wire that speaks the full type system. A tour through the language fundamentals, framed by You Don't Know JS."
tags: javascript, web-standards, modules, prototypes, serialization
author: Vivek
---

I re-read Kyle Simpson's [*You Don't Know JS*](https://github.com/getify/You-Dont-Know-JS) over a weekend, the way you re-read something you first met years ago and expect to find nothing new in. The books walk the parts of the language most of us skate over: lexical scope and closures, ES modules, the prototype chain, property descriptors, the type system and coercion, async iteration. Deep-JS material. The stuff you are supposed to internalize and then mostly stop thinking about once a framework takes over.

What struck me on the re-read was how much of it I had been staring at while building WebJs. Not as trivia. As the actual load-bearing structure of the framework. Each pillar of the book maps onto a decision I had already made, usually because trying to do it any other way was worse. So this post is that tour: the JavaScript fundamentals a framework can either lean on or paper over, and where WebJs lands on each.

# The bet most frameworks make

The dominant frameworks of the last decade made a coherent bet: the platform is not good enough, so we will build a better one on top and ask you to program against that instead. React gives you SyntheticEvent instead of the DOM event, a synthetic component lifecycle instead of the element lifecycle, rules-of-hooks instead of ordinary closures. It is a real language on top of JavaScript, and it is a good one. But the knowledge you build up is knowledge of React, and the day you leave React most of it does not travel with you.

WebJs makes the opposite bet. The closer you look at it, the more it is just JavaScript with a thin comfort layer, and the deeper your knowledge of the language runs, the more the framework rewards it instead of overriding it. That is not a slogan I put on the homepage. It is a thing you can see in the code, pillar by pillar.

# Modules are the framework, not a bundler input

*Scope & Closures* ends on ES modules, and treats them as the language's real unit of encapsulation: a module scope is a closure that runs once, exports are live bindings, imports are a static graph the engine can see before anything executes.

WebJs takes that literally. There is no build step. The `.ts` file you write is the file the browser fetches, with the types whitespace-erased in place. Which means the module graph is not a bundler's intermediate representation, it is the real thing the runtime walks. The framework reads your static `import` and `export` statements to decide what is even allowed to reach the browser: a file no client module imports is not servable, full stop. Dead components get their modules dropped because the graph shows nothing interactive depends on them.

The closure semantics carry weight too. A module-scope `signal()` is a value closed over by the module, created once, shared by every component that imports it. That is the module pattern from the book, used as shared state with no context provider and no event bus.

```ts
// modules/cart/state.ts
import { signal } from '@webjsdev/core';
export const items = signal<Item[]>([]);
```

An instance signal created in a constructor is the opposite: a fresh closure per element, component-local, gone when the element leaves the DOM. Same primitive, two scopes, and which one you reach for is a pure scoping decision. If you understand why one lives across navigations and the other does not, you already understand the framework's state model. There was nothing new to teach.

# Reactive properties are just property descriptors

*Objects & Classes* spends its hardest chapters on the thing most tutorials skip: a property is not a slot, it is a descriptor, and a plain data slot and an accessor pair are two different things wearing the same syntax.

WebJs components are real ES classes over a real prototype chain, and reactive properties are accessors. When you write `extends WebComponent({ count: Number })`, the factory installs a getter and setter pair with `Object.defineProperty`, so that assigning `this.count = 3` runs through a setter that schedules a render. There is no virtual DOM diffing a plain object. There is a property descriptor doing exactly what the language says a property descriptor does.

That design has one sharp edge, and it is the exact footgun the book warns about. If you declare the property as a class field:

```ts
class Counter extends WebComponent({ count: Number }) {
  count = 0;   // wrong: overwrites the accessor with a plain slot
}
```

the class field runs `[[Define]]` on the instance, and so did the factory's accessor, one line earlier inside `super()`. The field wins because it lands second, replacing the accessor with a plain data slot. The setter never fires, and the component silently stops reacting. This is the descriptor-versus-slot distinction straight out of Chapter 2, plus the initialization ordering the class-fields proposal spells out, and it is the kind of bug that eats an afternoon. WebJs catches it with a lint rule so you get told at check time instead of at 2am, but the reason the rule has to exist is that the framework respects the real object model rather than hiding it behind a setState bag. The right form sets the default in the constructor, after `super()`, where an assignment goes through the accessor:

```ts
class Counter extends WebComponent({ count: Number }) {
  constructor() { super(); this.count = 0; }
}
```

Static class fields, private `#` fields, class extension through `super`. None of these are framework concepts you learn on top of the language. They are the language, showing through because nothing is covering them up.

# The wire speaks the type system, not JSON

*Types & Grammar* is the book everyone thinks they do not need until they hit a coercion bug. Its whole argument is that JavaScript has a richer type system than the seven things JSON can hold, and that BigInt and Symbol and Map and the boxing rules are load-bearing, not corner cases.

The place a full-stack framework has to confront this is the server boundary. You call a server function from the client, its arguments and its return value cross the network, and something has to encode them. The universal baseline is `JSON.stringify`, and it is lossy in ways that map one-to-one onto the book's type chapters. `JSON.stringify(10n)` throws outright, because JSON has no BigInt. A `Map` serializes to `{}`, losing every entry. A `Set` becomes `{}` too. A `Symbol` vanishes. A reference cycle throws. The type system the book spends four chapters on does not survive the trip.

WebJs ships its own serializer, and it treats those types as first-class. I ran the real thing while writing this, round-tripping values through the actual wire encoder:

```
BigInt: bigint  true            // 12345678901234567890n comes back a bigint, value intact
Map: true  Set: true  1,2,3     // a Map holding a Set, both identities preserved
Symbol.for: true                // Symbol.for('cart') comes back === Symbol.for('cart')
Cycle: true                     // a self-referential object; o.self === o after the round-trip
```

`Date`, `Error`, typed arrays, `Blob`, `File`, and `FormData` ride across the same way. You import a `.server.ts` function into a client component, call it like a normal function, and a `Map` you returned arrives as a `Map`.

The two things the serializer refuses are as instructive as the things it keeps, because it refuses them for reasons the book explains. A local `Symbol` throws a `TypeError`, because a symbol's whole point is unforgeable identity: `Symbol('x')` on the server and `Symbol('x')` on the client are different symbols by definition, so there is no honest way to reconstruct one across a process boundary. Only `Symbol.for('x')`, which is a lookup in the global registry keyed by a string, has an identity both sides can agree on, so only that form survives. And a function throws a `TypeError`, because a function is a closure over a scope that does not exist on the other machine. You cannot serialize a closure, which is the closure chapter and the types chapter shaking hands. A framework that understood the type system less well would try, and ship you a broken function that silently does nothing.

# Async is the platform's, not a scheduler's

The async pillar is where a lot of frameworks reach hardest for their own machinery: a custom scheduler, a custom suspense cache, a rendering lane system. WebJs leans on the language primitives the async chapter is built on.

A component can write `async render()` and `await` its data inline, because a promise-returning render is just a function the runtime awaits, no special hook. A server action can return an async generator, a function that yields values over time instead of returning once, and the client consumes it with the plain iteration protocol:

```ts
for await (const chunk of await streamTokens(prompt)) {
  // each token arrives as the generator yields it
}
```

That is `for await...of` over an async iterable, exactly as specified, running across a network boundary. Back-pressure works because the protocol has back-pressure. Cancelling the consumer cancels the source generator because that is what closing an iterator does. There is no scheduler to learn. There is the language's async model, extended to reach the server.

# Why this is the trade I would make again

There is a real cost to this bet, and I want to name it rather than pretend it away. Frameworks that build their own world can move faster inside that world. React can change how events work because it owns events. WebJs cannot change how property descriptors work, so when the platform has a sharp edge, I inherit the sharp edge and put a lint rule in front of it instead of designing it out. That is a genuine tradeoff, and for some teams the all-inclusive abstraction is the right call.

But the payoff is the thing I kept feeling all weekend. The knowledge in *You Don't Know JS* does not expire when you adopt WebJs, and it does not sit unused either. Understanding closures tells you why a module signal is shared and an instance signal is not. Understanding property descriptors tells you why a class field breaks reactivity. Understanding the type system tells you why a `Map` survives the wire and a local symbol cannot. The framework is not a layer you learn instead of the language. It is the language, arranged, with the smallest possible amount of new vocabulary on top.

That is the whole idea, and it is why the deeper you know JavaScript, the less of WebJs there is left to learn.
