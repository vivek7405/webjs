/**
 * Light-DOM <slot> runtime for @webjsdev/core: FULL NATIVE PARITY (#1021).
 *
 * `<slot>` works identically in light DOM and shadow DOM, through the SAME
 * native DOM API. You write the same template, and moving a component between
 * `static shadow = false` and `true` never needs a rewrite. A FORWARDED slot
 * (a template forwarding `<slot>` into a nested component) projects its
 * content on the client and through hydration too (#1023): the renderer
 * stamps each slot with its template owner (SLOT_OWNER), carried across SSR
 * as `data-wj-slot-owner`, so a forwarded slot routes to the OUTER host that
 * rendered it, not the child it nests in. Native `<slot>` is
 * a shadow-DOM primitive, so in light DOM WebJs implements slotting itself, to
 * spec: named + default slots, fallback content, first-wins resolution, dynamic
 * `name=${...}`, and live post-mount writes (appendChild, insertBefore,
 * removeChild, innerHTML, `el.slot=` flips, HTMLSlotElement.assign) plus the
 * full read surface (assignedNodes / assignedElements / {flatten} /
 * assignedSlot / slotchange, with native async-coalesced slotchange timing).
 * One caveat rides assign() specifically. The light-DOM assign() is an
 * EXTENSION of native (an element-bound per-node overlay while name matching
 * keeps working); native shadow assign() requires slotAssignment 'manual' on
 * the shadow root, which WebJs does not set, so in `static shadow = true`
 * mode assign() is a native no-op. Avoid assign() in a component meant to
 * flip modes.
 *
 * ONE WRITER. The design's core invariant: the component's own renderer is the
 * only actor that moves authored nodes into slots (`applySlotAssignments`).
 * `authored: Node[]` is the ordered source of truth; `assignedByName` is a pure
 * derivation (`repartition`). Liveness comes from re-running that one writer,
 * never from a second node-mover. This is what the pre-#1016 architecture got
 * wrong: it live-re-projected via a MutationObserver that PHYSICALLY MOVED
 * nodes, a third DOM writer beside the renderer and the client router, and the
 * ownership overlap was the #906/#908/#912/#914, #1006, and #994 bug cascade.
 *
 * How liveness reaches the one writer:
 *   - Interception: the mutating methods are patched per-instance on a light
 *     host; an author write updates `authored` + repartitions + applies.
 *   - Renderer-write window (RENDERING): the renderer opens it around every
 *     host-receiver commit (including the async paths), so a renderer commit is
 *     never mistaken for authored content. The one discriminator, structural.
 *   - Sensors (read-only, never move nodes): a childList backstop for raw
 *     bypass writes, and a slot/name flip sensor for attribute flips.
 *   - Prune rule: a node the author detaches (el.remove()) or re-parents is
 *     dropped from `authored` by its real parent, killing zombie resurrection
 *     and cross-host theft.
 *   - Self-heal, in resyncActualSlots. The record is NOT the only legitimate
 *     writer INSIDE a slot; a parent component's hole committed there and a
 *     library operating on the assigned container are folded back into
 *     `authored` before every apply, with NODE-scoped order authority
 *     (physical order adopted except for the exact nodes a record op
 *     touched), so the one writer never destroys another writer's work.
 *
 * Documented inherent gaps (all from light DOM having no shadow boundary): structural
 * host reads (`host.children` / `childNodes` / the innerHTML GETTER show the
 * rendered template, not the authored children), `assignedChild.parentNode` is
 * the `<slot>`, `::slotted()` CSS (use normal selectors / Tailwind), and
 * initial-projection lifecycle timing: the first light-DOM projection lands
 * one microtask AFTER the first render, so `firstUpdated` sees the `<slot>`
 * element with EMPTY `assignedNodes()` (shadow DOM projects natively before
 * it); read assigned content from `slotchange` or after a microtask.
 *
 * Live writes need the component's JS on the page. Interception + sensors
 * install in connectedCallback, so a component the framework ELIDES (a
 * display-only slotted wrapper with no client signal) ships no JS and its
 * post-mount native writes are inert, like anything on an elided component.
 * A component that is actually interacted with ships (a client module
 * references its tag); for an imperative consumer reaching it through a
 * string selector the analyser cannot see, force the ship with
 * `static interactive = true`. Shadow components always ship (the DSD
 * carve-out), so this is the one place elision, not slots, sets the boundary.
 *
 * Polyfill safety. Every prototype patch checks for the `data-webjs-light`
 * attribute and falls through to native otherwise, so real shadow-DOM slots
 * keep native behaviour exactly.
 *
 * SSR. This module is import-safe in Node (DOM access is guarded on
 * `typeof HTMLSlotElement !== 'undefined'`). Server-side slot substitution
 * lives in render-server.js (injectDSD); slot.js drives the client runtime.
 */

// ---------------------------------------------------------------------------
// Module-scope constants
// ---------------------------------------------------------------------------

export { applyActualAssignment, applyFallback, fireSlotChange, hasFrameworkRenderedSubtree, queueSlotChange, rescueAssignedNodes } from './slot/assignment.js';
export { installSlotInterception, isAuthoredContentSlot } from './slot/interception.js';
export { installSlotPolyfills } from './slot/polyfills.js';
export { applySlotAssignments, projectAuthored } from './slot/project.js';
export { drainRendererBackstop, installSlotSensors, reconnectSweep, teardownSlotSensors, withRendererWrites } from './slot/sensors.js';
export { adoptSSRAssignments, captureAuthoredChildren, ensureSlotState, hasSlotState, keyOfName, repartition } from './slot/state.js';
export { LIGHT_SLOT_ATTR, PROJECTION_ACTUAL, PROJECTION_ATTR, PROJECTION_FALLBACK, RENDERING, SLOT_FALLBACK_FRAG, SLOT_OWNER, SLOT_OWNER_ATTR, SLOT_STATE } from './slot/symbols.js';
