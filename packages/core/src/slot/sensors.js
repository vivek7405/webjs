/**
 * MutationObserver sensors that keep a host in sync with post-mount
 * native writes, plus the renderer-write backstop.
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { isOwnSlot } from './assignment.js';
import { instanceOwns } from './interception.js';
import { inBrowser } from './polyfills.js';
import { applySlotAssignments } from './project.js';
import { ensureSlotState } from './state.js';
import { FRAMEWORK_DETACHED, LIGHT_SLOT_ATTR, PARK, RENDERING, SLOT_STATE } from './symbols.js';

// Saved native references, captured once in the browser (Node has no `Node`).
export let N_appendChild = null;
export let N_insertBefore = null;
export let N_removeChild = null;
export let N_replaceChild = null;
export let N_append = null;
export let N_prepend = null;
export let N_replaceChildren = null;
export let INNER_HTML_DESC = null;
export let TEXT_CONTENT_DESC = null;

export function captureNatives() {
  if (N_appendChild || !inBrowser) return;
  N_appendChild = Node.prototype.appendChild;
  N_insertBefore = Node.prototype.insertBefore;
  N_removeChild = Node.prototype.removeChild;
  N_replaceChild = Node.prototype.replaceChild;
  N_append = Element.prototype.append;
  N_prepend = Element.prototype.prepend;
  N_replaceChildren = Element.prototype.replaceChildren;
  INNER_HTML_DESC = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  TEXT_CONTENT_DESC = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
}

/**
 * Run `fn` with the renderer-write window open on `host`, restoring the prior
 * flag afterward (re-entrancy safe: nested renderer commits nest cleanly). The
 * renderer wraps every host-receiver commit in this; a write to a light host
 * inside the window bypasses the interception and hits the native DOM.
 *
 * @template T
 * @param {any} host
 * @param {() => T} fn
 * @returns {T}
 */
export function withRendererWrites(host, fn) {
  const prev = host[RENDERING];
  host[RENDERING] = true;
  try {
    return fn();
  } finally {
    host[RENDERING] = prev;
    // When the OUTERMOST window closes, drain the backstop synchronously before
    // its async callback fires. The drain PROCESSES the records (renderer output
    // is skipped structurally, a genuine bypass write is folded), so this
    // commit's own childList churn is absorbed without losing a real author
    // write that coincided in the same task. (The flip sensor is NOT drained: a
    // renderer `name=` write on a slot is exactly what re-projects a dynamic
    // `name=${...}`.)
    if (!prev) drainRendererBackstop(host);
  }
}

/**
 * Install the two read-only sensors on a light host. Neither moves a node; each
 * only folds a mutation into `authored` and calls the single renderer-owned
 * writer. Installed on connect, torn down on disconnect.
 *   - Bypass backstop (childList, subtree:false): catches raw writes that skip
 *     the patched methods (`Node.prototype.appendChild.call`, Range ops).
 *   - Flip sensor (attributes slot/name, subtree:true): catches an `el.slot=`
 *     flip on a projected child and a slot `name=` change.
 *
 * @param {Element} host
 */
export function installSlotSensors(host) {
  if (!inBrowser) return;
  const h = /** @type {any} */ (host);
  const state = ensureSlotState(host);
  if (state.backstop) return;

  state.backstop = new MutationObserver((records) => processBackstop(host, state, records));
  state.backstop.observe(host, { childList: true, subtree: false });

  state.flipSensor = new MutationObserver((records) => processFlip(host, records));
  state.flipSensor.observe(host, {
    attributes: true,
    attributeFilter: ['slot', 'name'],
    subtree: true,
  });
}

/**
 * Backstop callback body: fold a raw direct-child add / un-author a raw remove.
 * A renderer-committed node (the render root and everything between the instance
 * bookend markers) is SKIPPED structurally, so this is safe to run on the
 * records drained at a renderer-write window close, not only on genuine
 * author-bypass records. That is what keeps a real bypass write that happened
 * to coincide with a commit in the same task from being silently dropped.
 */
export function processBackstop(host, state, records) {
  const h = /** @type {any} */ (host);
  const park = h[PARK];
  const inst = h[Symbol.for('webjs.instance')];
  let dirty = false;
  // Nodes the AUTHOR touched in THIS pass (any addedNodes appearance): for
  // them, the latest same-pass author action wins, so a following removal
  // record splices even a marked node.
  const touchedThisPass = new Set();
  for (const r of records) {
    for (const node of r.addedNodes) {
      touchedThisPass.add(node);
      if (node === park) continue;
      if (inst && instanceOwns(inst, node)) continue; // renderer output, not authored
      if (state.authored.indexOf(node) !== -1) {
        // A raw bypass MOVE of an already-authored node back onto the host:
        // the record is right but the node now physically sits outside its
        // slot. Re-apply so the physically-verifying placement step repairs
        // it (no slotchange fires: the assigned SET is unchanged).
        dirty = true;
        continue;
      }
      FRAMEWORK_DETACHED.add(node);
      state.authored.push(node);
      dirty = true;
    }
    for (const node of r.removedNodes) {
      const i = state.authored.indexOf(node);
      if (i === -1) continue;
      if (host.contains(node)) continue; // placement/park move: still ours
      // Containment is evaluated at PROCESSING time, so a stale placement
      // record (host to slot move) can be processed after a rescue detached
      // the node as a record value: retain exactly that shape (marked,
      // parentless, untouched by the author this pass). Everything else in
      // a host-childList removal record was author-removed or author-moved
      // (their same-pass add marks touchedThisPass; a placed node is
      // unmarked; a re-homed node has a parent) and leaves the record.
      const rescueValue =
        FRAMEWORK_DETACHED.has(node) &&
        node.parentNode == null &&
        !touchedThisPass.has(node);
      if (!rescueValue) {
        state.authored.splice(i, 1);
        dirty = true;
      }
    }
  }
  if (dirty) applySlotAssignments(host);
}

/**
 * Drain the host's backstop at a renderer-write window close, PROCESSING the
 * records (renderer output is skipped structurally by processBackstop) so a
 * genuine bypass write coinciding with the commit is not lost. Exported so
 * render-client's render() window can share the exact same drain.
 *
 * @param {Element} host
 */
export function drainRendererBackstop(host) {
  const h = /** @type {any} */ (host);
  const state = /** @type {SlotState | undefined} */ (h[SLOT_STATE]);
  if (!(state && state.backstop)) return;
  const records = state.backstop.takeRecords();
  // Only PROCESS when there is a rendered instance: processBackstop skips
  // renderer output via instanceOwns, which needs the instance bookends. On the
  // non-template render path (render() returns a string / array / number) the
  // instance is null and the renderer's own text nodes are direct host
  // children, so processing would fold them into the record and park them (the
  // component would render blank). With no instance to discriminate, discard,
  // matching the pre-processing behavior.
  // Process when an instance exists OR the host has NEVER rendered (the
  // symbol is absent: a pre-first-render bypass write must be folded so the
  // first render's replaceChildren does not silently destroy it); discard
  // only on the EXPLICIT null of the non-template render path, whose text
  // output would otherwise be folded and parked.
  const hasInstanceSym = Symbol.for('webjs.instance') in h;
  if (!hasInstanceSym || h[Symbol.for('webjs.instance')]) {
    processBackstop(host, state, records);
  }
}

/**
 * Flip-sensor callback body: a RELEVANT slot=/name= flip re-derives + re-places.
 * Relevant = a `name=` change on one of the host's own light slots, or a `slot=`
 * change on an authored (projected) child. An unrelated `name=` deep in the tree
 * (e.g. an `<input name>`) is ignored, so common markup does not trigger a
 * spurious full re-apply.
 */
function processFlip(host, records) {
  const state = /** @type {SlotState | undefined} */ (
    /** @type {any} */ (host)[SLOT_STATE]
  );
  if (!state) return;
  // ONE pass over ALL records first: every explicit slot= change clears that
  // node's self-heal adoption (the author's attribute is now the routing
  // intent), unconditionally. Deleting for a node no longer authored is
  // always safe, and gating on authored membership let a stale adoption
  // outlive a same-task detach and mis-route a later re-append. Only then is
  // relevance decided and the single apply run, so a batch with several
  // relevant flips never leaves a later record's adoption uncleared.
  let relevant = false;
  for (const r of records) {
    if (r.type !== 'attributes') continue;
    const target = /** @type {Element} */ (r.target);
    if (r.attributeName === 'name') {
      if (
        target.tagName === 'SLOT' &&
        target.hasAttribute(LIGHT_SLOT_ATTR) &&
        isOwnSlot(host, target)
      ) {
        relevant = true;
      }
    } else if (r.attributeName === 'slot') {
      if (state.adoptedKey) state.adoptedKey.delete(target);
      if (state.authored.indexOf(target) !== -1) relevant = true;
    }
  }
  if (relevant) applySlotAssignments(host);
}

/**
 * Tear down the sensors, PROCESSING any queued records first (a bare
 * `disconnect()` drops them, which would lose a flip or bypass write captured
 * but not yet delivered when the host disconnects).
 *
 * @param {Element} host
 */
export function teardownSlotSensors(host) {
  const state = /** @type {SlotState | undefined} */ (
    /** @type {any} */ (host)[SLOT_STATE]
  );
  if (!state) return;
  if (state.backstop) {
    processBackstop(host, state, state.backstop.takeRecords());
    state.backstop.disconnect();
    state.backstop = undefined;
  }
  if (state.flipSensor) {
    processFlip(host, state.flipSensor.takeRecords());
    state.flipSensor.disconnect();
    state.flipSensor = undefined;
  }
}

/**
 * Reconnect sweep: after a host is re-inserted, fold any direct host child that
 * is not already authored, not the park, and not the render root into
 * `authored` (covers a raw bypass write made while the host was disconnected,
 * which no sensor was live to see). Then re-apply.
 *
 * @param {Element} host
 */
export function reconnectSweep(host) {
  if (!inBrowser) return;
  const h = /** @type {any} */ (host);
  const state = /** @type {SlotState | undefined} */ (h[SLOT_STATE]);
  if (!state) return;
  const inst = h[Symbol.for('webjs.instance')];
  const rendered = Symbol.for('webjs.instance') in h;
  // Gate on the RECORDED connect branch (adoptSSRAssignments sets
  // state.adopted), never on structural re-detection: a bypass write can
  // itself carry a rendered-looking chunk (slot[data-webjs-light]
  // [data-projection] under plain wrappers) and would spoof a structural
  // check, suppressing the fold for unrelated writes in the same batch.
  // The flag is also free per reconnect where the structural query walked
  // the subtree.
  const adoptedMarkup = !rendered && state.adopted === true;
  let changed = false;
  for (const node of Array.from(host.childNodes)) {
    if (node === h[PARK]) continue;
    if (state.authored.indexOf(node) !== -1) {
      // Authored but physically a direct host child: a bypass MOVE made
      // while disconnected pulled it out of its slot. Re-apply so the
      // placement step repairs it.
      changed = true;
      continue;
    }
    // Skip the renderer's own top-level nodes. With an instance, ownership
    // is checked via the bookends. With an EXPLICIT null instance (the
    // non-template render path sets host[INSTANCE] = null: render() returned
    // a string / number / array) the renderer's text output IS the direct
    // host children, so folding is skipped entirely, like
    // drainRendererBackstop's no-instance guard. A host that has NEVER
    // rendered (the symbol is absent: moved before its deferred first
    // render) has no CLIENT-renderer output, so a disconnected-window
    // bypass write IS folded UNLESS the host carries adopted
    // framework-rendered markup (SSR/hydration before the deferred first
    // render, or a first render that threw): folding THAT subtree would
    // push template wrappers into the record and brick placement on a
    // HierarchyRequestError.
    if (rendered && (!inst || instanceOwns(inst, node))) continue;
    if (!rendered && adoptedMarkup) continue;
    FRAMEWORK_DETACHED.add(node);
    state.authored.push(node);
    changed = true;
  }
  if (changed) applySlotAssignments(host);
}
