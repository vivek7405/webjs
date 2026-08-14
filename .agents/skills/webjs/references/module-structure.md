# Module structure: file size, design principles, and splitting a large module

Read this before splitting a large source file, and before arguing about how
big a module is allowed to be.

Two things live here. The first is what "well structured" means in this repo,
which is mostly judgment rather than a number. The second is the mechanical
procedure for barrelling a large module into a directory, which is NOT judgment:
it has a small number of failure modes that are silent, and every one of them
has bitten this codebase already.

---

## Design principles: judgment, not a checker

SOLID, DRY, and KISS apply here the way they apply anywhere. They are prose
guidance, followed by judgment, and deliberately NOT enforced by `webjs check`.
That split is the same one the rest of the project uses: `webjs check` carries
correctness rules only (code that is wrong to ship), and anything a sensible
project could reasonably do differently stays a convention.

What they mean in practice, in a buildless framework whose source IS what runs:

- **Single responsibility** is about what a module OWNS, not how long it is. A
  module owns one concern when you can state that concern in a sentence without
  the word "and". `router-client/prefetch.js` owns speculative fetching. It is
  584 lines, and it is one responsibility.
- **DRY applies to knowledge, not to text.** Two identical lines that would
  change for different reasons are not duplication. A constant that appears in
  three places IS, which is why this repo has drift guards that read one copy
  and assert it against another (see the guard section below).
- **KISS beats cleverness in a framework more than in an app.** The source is
  the documentation surface for the AI agents that use WebJs, and it ships
  unbundled to be read. An indirection that saves five lines and costs a reader
  a jump is a bad trade here.
- **Dependency direction matters more than dependency inversion.** Modules layer
  downward: constants at the bottom, then pure helpers, then orchestration.
  Nothing imports upward. This is not architectural taste, it is what keeps ESM
  cycles out (see below). Two subsystems are genuinely mutually recursive and
  cannot layer, the client router (a navigation fetches, the fetch swaps, the
  swap upgrades, an upgraded element navigates) and light-DOM slots (projecting
  installs the interceptors, an intercepted mutation re-projects). Those two are
  named in `test/architecture/import-cycles.test.mjs`, which fails on any THIRD
  cycle, so the rule holds everywhere it can.

---

## File size: target 800, ceiling around 1000

**A source module targets 800 lines and should stay around 1000 at the most.**
The ceiling is approximate on purpose. A module at 1040 is fine; one at 1900
needs either a split or a named exemption (below), and the question to ask at
that size is which responsibility it has picked up rather than how many lines
it has. A barrel is exempt entirely, because its length is a function of how
many names it re-exports.

**Where this number comes from.** It was set by measuring the frameworks this
project takes its cues from, not by picking a round figure:

| Module | Lines |
|---|---|
| `lit/packages/lit-html/src/lit-html.ts` | 2303 |
| `lit/packages/reactive-element/src/reactive-element.ts` | 1754 |
| `vite/packages/vite/src/node/optimizer/index.ts` | 1487 |
| `vite/packages/vite/src/node/server/index.ts` | 1447 |

Every one of them draws its seams by responsibility and lets the orchestration
entry stay large. None of them enforces a line count.

**A much smaller cap is a bad trade, and this repo has the measurement.**
Splitting ten modules into about ninety produced three bindings that needed
accessors because ESM forbids assigning an imported binding, one dropped import
that threw only inside a deferred callback, one symbol identity swap that
silently broke slot forwarding, and three drift guards that broke or would have
passed vacuously. Four of those six were invisible to `npm test`. Every module
boundary is a place where those failures can happen, so boundaries are worth
adding for cohesion and worth nothing when added to hit a number.

There is also a runtime cost. In dev the browser fetches core source files
individually rather than the bundle, so N modules is N requests at one more
level of import-graph depth.

**The ceiling is measured with a RAW line count** (the number `wc -l` prints,
the number you see when you open the file), because that is how #1365 specified
it and because a metric a reader cannot reproduce by looking at the file invites
argument about the metric instead of the module. The tension with dense
documentation is real: this repo's comment style can put a well-factored module
at twice its code size, and a raw ceiling must never become a reason to delete
explanation. The answer to that tension is the exemption list, not a different
metric.

**There is deliberately NO CI guard for this.** A line-count gate is a proxy
metric that fights cohesion: it reds forever on a generated data table like
`html-entities.js`, and it has to carry an exemption list that rots. So the
ceiling is a REVIEW-TIME check, not a test. Measure it when you split something:

```sh
find <the tree you produced> -name '*.js' -exec wc -l {} + | awk '$1 > 1000 && $2 != "total"'
```

**A module that genuinely cannot or should not go under the ceiling gets a
NAMED exemption**, argued in the PR that produces it, with its measured size and
its reason. The three exemptions the #1365 split carries show what a valid
reason looks like:

- **lit parity** (`component/lifecycle.js`): the file tracks lit's
  `reactive-element.ts`, which lit keeps WHOLE at 1754 lines, and the project's
  standing decision is to keep lit-derived code close to lit rather than
  restructure it.
- **mutual recursion** (`render-client/parts.js`): the apply and instance group
  calls back into itself, so a real split creates the import cycle the D4 rule
  forbids, and the escape (a runtime dispatch registry) is a worse trade.
- **a single closure over shared request state** (`dev/handler.js`): splitting
  means threading that state through a context object, a high-risk rewrite of
  every app's boot path for zero behaviour gain.

Note what a valid reason is NOT: "it is mostly comments." If a module is over
the ceiling only because it is well documented, that is a signal the ceiling is
being measured too literally, not grounds for an exemption. Say why the CODE
cannot be split, or split it.

---

## Splitting a module into a barrel plus a directory

The naming rule, settled once for the whole framework: **the original file keeps
its path and becomes the barrel, and its parts land in a sibling directory named
after it.** So `packages/core/src/slot.js` stays, and its parts go in
`packages/core/src/slot/`. Do NOT rename the barrel to match a public export
subpath. The `package.json` `exports` map, the hand-written `.d.ts` overlays and
their two guard tests, the docs pages that print importmap examples, and every
relative test import all key off the current path.

### The rule that matters most

**A split is a MOVE, not a rewrite.** Retyping a function while relocating it is
how a refactor with a green export surface ships behaviour changes. Move the
lines verbatim. The only edits a move should produce are the `export ` keyword
where a declaration now crosses a module boundary, and the generated import
lines.

### Where mutable module state goes

A module-scope `let` goes in the module that WRITES it, not the module that
looks like its topical home. ESM import bindings are read-only, so a module
cannot assign a binding it imported.

When two modules genuinely write the same binding, the owner exposes a
one-statement accessor and the other module calls it:

```js
// scroll.js owns the counter.
export let restoreGeneration = 0;
export function bumpRestoreGeneration() { restoreGeneration += 1; }

// navigator.js reads the live binding and calls the accessor to write.
import { restoreGeneration, bumpRestoreGeneration } from './scroll.js';
```

Keep importing the binding itself wherever it is READ. Dropping it from the
import list while a read site survives leaves a free variable, which throws only
when that line executes. In the client router that meant a Back-button scroll
restore silently landing at offset 0, with every node test still green.

### Cycles and TDZ

Layer the modules and never import upward. Node tolerates an import cycle, but
reading a `const` or `class` binding during the cycle's evaluation phase throws
a TDZ `ReferenceError` at module load, and in a minified browser bundle that is
a blank page rather than a test failure.

Where a back edge is unavoidable, resolve it by calling a function at call time
rather than reading a binding at module scope.

### Symbol identity

`Symbol('x')` mints a unique value. `Symbol.for('x')` looks one up in the global
registry by string. They are never interchangeable, and substituting one for the
other produces a value that no existing object carries, so every lookup quietly
returns `undefined`. Import the symbol from the module that created it.

### Drift guards read source files by path

This repo has guard tests that `readFileSync` a source file and grep it for a
constant, to pin two copies of a value against each other. Barrelling a file
breaks every one of them, and breaks them in two different ways:

- an `assert.match` fails on its own precondition, which is loud and fine;
- an `assert.doesNotMatch` starts passing **vacuously**, which is silent and is
  the reason this is written down.

After any split, grep the test tree for reads of the file you just barrelled and
point each guard at the barrel PLUS every module beneath it.

### Verification, in order

```sh
# 1. Export surface is identical, in BOTH directions. `added` must be empty too:
#    a behaviour-preserving split adds no public surface.
node --input-type=module -e "
  const before = await import('/tmp/before.js');
  const after  = await import('./packages/core/src/<file>.js');
  const A = Object.keys(before).sort(), B = Object.keys(after).sort();
  console.log(JSON.stringify({
    missing: A.filter((k) => !B.includes(k)),
    added:   B.filter((k) => !A.includes(k)),
  }));
"

# 2. Every code line survived. Normalize away comments and the `export ` prefix,
#    then diff. Anything left is a line the split CHANGED, and each one needs a
#    reason in the commit message.

# 3. The module loads at all (catches a TDZ throw introduced by a cycle).
node --input-type=module -e "await import('./packages/core/index-browser.js')"
node --input-type=module -e "await import('./packages/core/index.js')"

# 4. Rebuild dist BEFORE any e2e or Bun run, which resolve the built bundle and
#    would otherwise test the pre-split code and pass vacuously.
node scripts/build-framework-dist.js

# 5. The browser suite is MANDATORY for a renderer, router, component, or slot
#    split. Those defects are post-hydration: the export surface is unchanged,
#    the SSR bytes are unchanged, and node tests stay green.
npm test && npm run test:browser
```

Step 5 is not optional and not a formality. Of the two silent defects this
codebase has hit from splitting, both were caught by the browser suite alone.
