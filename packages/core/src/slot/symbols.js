/**
 * Symbol keys, attribute names and shared constants for the light-DOM
 * slot runtime. The leaf of the directory: it imports nothing.
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { isOwnSlot } from './assignment.js';
import { installSlotPolyfills } from './polyfills.js';

/**
 * Symbol-keyed slot state stored on each light-DOM WebComponent host.
 * Lazily initialised by ensureSlotState(host).
 */
export const SLOT_STATE = Symbol('webjs.slot.state');

/** Marker attribute that opts a <slot> element into framework projection. */
export const LIGHT_SLOT_ATTR = 'data-webjs-light';

/** Records whether a slot is showing real assignment or fallback. */
export const PROJECTION_ATTR = 'data-projection';

export const PROJECTION_ACTUAL = 'actual';
export const PROJECTION_FALLBACK = 'fallback';

/**
 * Symbol-keyed property on a slot element that holds a DocumentFragment
 * containing the slot's fallback content (cloned from the compiled template
 * by render-client.js at slot-part bind time). The apply step swaps these
 * nodes into and out of the slot as the projection state toggles between
 * "actual" and "fallback".
 */
export const SLOT_FALLBACK_FRAG = Symbol('webjs.slot.fallbackFrag');

/**
 * The host whose TEMPLATE produced this `<slot>` (the render container the
 * renderer cloned the template into). Authoritative over the structural
 * `isOwnSlot` walk: a slot a template FORWARDS into a nested component
 * (`html\`<inner><slot></slot></inner>\``) sits physically inside that child
 * but is owned by the OUTER host, which the structural walk (a custom element
 * sits between them) gets wrong. Stamped by the renderer at bind time
 * (render-client) and resolved from the SSR `data-wj-slot-owner` attribute on
 * hydration so client-only mount and hydration share one mechanism.
 */
export const SLOT_OWNER = Symbol('webjs.slot.templateOwner');

/** The SSR carrier for SLOT_OWNER (a symbol cannot cross the HTML boundary). */
export const SLOT_OWNER_ATTR = 'data-wj-slot-owner';

/** Maximum recursion depth for assignedNodes({flatten: true}); guards cycles. */
export const FLATTEN_MAX_DEPTH = 64;

// ---------------------------------------------------------------------------
// Saved native references and prototype polyfills
//
// Module-load tries to install polyfills immediately. In a pure Node
// process without a DOM library, HTMLSlotElement is undefined and the
// install is a no-op. Tests that set up linkedom AFTER module load can
// call installSlotPolyfills() explicitly to re-attempt the install.
// Subsequent calls are idempotent; native references are captured only
// on the first successful install.
// ---------------------------------------------------------------------------

/**
 * Set on a host WHILE the renderer is committing into it. The patched host
 * methods check it and delegate to the saved native, so a renderer commit is
 * never mistaken for authored content. This is the one discriminator between
 * renderer writes and author writes: a synchronous framework-write window, set
 * structurally (an own symbol), never inferred from comment markers.
 */
export const RENDERING = Symbol('webjs.slot.rendering');

/** Marks a host whose mutating methods have been patched (install once). */
export const INTERCEPTED = Symbol('webjs.slot.intercepted');

/** The per-host hidden holding element for authored nodes whose slot name
 *  matches no rendered slot (native keeps them connected but unrendered). */
export const PARK = Symbol('webjs.slot.park');

/**
 * Authored nodes the framework detached ON PURPOSE (capture, teardown rescue),
 * so the prune rule does not treat them as author-removed while they sit
 * parentless waiting to be (re)placed. Cleared once a node is placed.
 */
export const FRAMEWORK_DETACHED = new WeakSet();
