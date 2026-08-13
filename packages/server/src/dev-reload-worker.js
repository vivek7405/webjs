/**
 * The dev live-reload SharedWorker relay (#887), the BROWSER half. Kept as a
 * standalone browser-safe module (no node imports) so the served worker inlines
 * the EXACT source a browser test drives, with no drift, the same pattern as
 * `dev-overlay.js` (#264).
 *
 * BOTH served dev scripts inline this file, `export`-stripped. `reloadWorkerJs`
 * appends a `startReloadWorker(self, EventSource, '<eventsUrl>')` call for the
 * SharedWorker, and since #1397 `reloadClientJs` inlines it too, so the per-tab
 * fallback runs this same relay over a shim port instead of a second copy of
 * the boot-id rule and the reload debounce.
 *
 * One SharedWorker is shared across every tab of the origin (a SharedWorker is
 * keyed by its script URL), so it holds the ONE `EventSource` to
 * `/__webjs/events` and fans each `reload` / `webjs-error` out to every tab over
 * its `MessagePort`. Tab count never touches the browser's per-host HTTP/1.1
 * connection cap, which the per-tab `EventSource` it replaces used to exhaust.
 */

/**
 * Reload coalescing (#1397). An agent saves several files a second or two
 * apart, and EACH save produces TWO reload signals: the in-process `reload`
 * frame from the fs.watch rebuild, then a changed boot id when the browser
 * reconnects to the process `node --watch` restarted (measured 429ms apart, and
 * 1071ms between one save's reconnect and the next save's in-process frame).
 * Acting on every one reloads into a server that is about to be killed again,
 * which is how the page ends up unstyled.
 *
 * 2000ms is above the measured 1071ms inter-save gap so a realistic burst
 * collapses to one reload, and deliberately not NEAR it, since a window close
 * to that gap fires just as the next restart begins. It also lands just past
 * the 1900ms analysis warm measured on the website app, which is the useful
 * place for it: the restarted process kicks off `warmup()` as soon as it
 * listens, so the wait overlaps work the reload request would have blocked on
 * anyway and the reload arrives at a server that has finished warming.
 */
export const RELOAD_QUIET_MS = 2000;

/**
 * The longest a reload is ever held, measured from the FIRST signal of a batch
 * (#1397). A quiet window alone would freeze the page on stale content for a
 * whole agent burst, so a sustained burst still repaints at least this often.
 * 2.5x the quiet window, so it never fires for an ordinary pair of edits.
 */
export const RELOAD_MAX_HOLD_MS = 5000;

/**
 * Verdict strength, STRONGEST FIRST (#1398). Mirrors `RELOAD_VERDICTS` in the
 * server's `dev-classify.js`; duplicated rather than imported because this file
 * is inlined verbatim into two served browser scripts and must stay
 * import-free.
 *
 * A batch collapses to ONE emitted reload, so it must take the STRONGEST
 * verdict in the batch and never the last one: a burst mixing a page edit and a
 * component edit is a component edit, and morphing it would leave the old
 * component class running against fresh markup.
 */
export const VERDICT_STRENGTH = ['reload', 'shell', 'page'];

/**
 * Resolve an SSE `reload` frame's `data` to a verdict name.
 *
 * ANY failure resolves to `reload`: an absent payload, malformed JSON, a
 * non-object, a `v` outside the three literals, or the legacy bare `data: now`.
 * That is what makes the wire-format change safe in both directions between a
 * long-running browser tab and a restarted server, since the worst a skew can
 * produce is the full reload that was the behaviour before this existed.
 *
 * @param {string} data
 * @returns {string} one of VERDICT_STRENGTH
 */
export function parseVerdict(data) {
  try {
    const o = JSON.parse(data);
    if (o && typeof o === 'object' && VERDICT_STRENGTH.indexOf(o.v) !== -1) return o.v;
  } catch (_) { /* fall through to the fail-safe */ }
  return 'reload';
}

/**
 * @param {{ onconnect: any, setTimeout?: any, clearTimeout?: any }} scope  the
 *   worker global (`self`), or a plain shim object for the per-tab fallback.
 *   Timers are read off it when it has them, which is what lets a browser test
 *   drive the debounce on a fake clock.
 * @param {new (url: string) => any} EventSourceCtor  the `EventSource` constructor
 * @param {string} eventsUrl  the base-path-aware `/__webjs/events` URL
 */
export function startReloadWorker(scope, EventSourceCtor, eventsUrl) {
  /** @type {Set<any>} */
  const ports = new Set();
  /** @type {string | null} the last error frame, cached for late-joining tabs */
  let lastError = null;
  /** @type {string | null} the last-seen per-process boot id (#893) */
  let lastBoot = null;

  // Timers come from the worker global when it has them (the real SharedWorker
  // scope does, and so does a tab running the per-tab fallback), else the
  // ambient globals. Reading them off `scope` is what lets the browser test
  // drive a fake clock and keep its assertions synchronous, and calling them as
  // `timers.setTimeout(...)` keeps `this` the global in a real browser.
  const timers = scope && typeof scope.setTimeout === 'function' ? scope : globalThis;

  // A MessagePort has no reliable close event, so prune a port when a post to it
  // throws (a closed tab). Some browsers silently no-op instead of throwing,
  // leaving a dead port in the set, but that is a harmless dev-only no-op and
  // the set is bounded by the tabs opened in one session.
  function fanout(msg) {
    for (const p of ports) {
      try { p.postMessage(msg); } catch (_) { ports.delete(p); }
    }
  }

  // The ONE debounced reload emitter (#1397). Two timers rather than a clock:
  // the quiet timer is re-armed by every signal, the cap timer is armed once
  // per batch and NEVER re-armed, so the cap measures from the first signal of
  // the batch instead of sliding with the burst. Whichever fires first emits
  // and cancels the other, which also starts a fresh batch.
  /** @type {any} */ let quietTimer = null;
  /** @type {any} */ let capTimer = null;

  /** @type {string} the strongest verdict seen in the CURRENT batch (#1398) */
  let batchVerdict = 'page';

  function emitReload() {
    if (quietTimer !== null) { timers.clearTimeout(quietTimer); quietTimer = null; }
    if (capTimer !== null) { timers.clearTimeout(capTimer); capTimer = null; }
    const v = batchVerdict;
    // Resetting HERE rather than in requestReload is load-bearing: emitReload is
    // the single place a batch ends, and it is reached from both timers.
    batchVerdict = 'page';   // a fresh batch starts at the weakest verdict
    fanout({ type: 'reload', verdict: v });
  }

  /** Strength rank; an unrecognised name ranks strongest, so it can only ever
   * over-reload. @param {string} v */
  function rank(v) {
    const i = VERDICT_STRENGTH.indexOf(v);
    return i === -1 ? 0 : i;
  }

  /** @param {string} verdict */
  function requestReload(verdict) {
    // Lower rank is stronger, so keep the minimum across the batch.
    if (rank(verdict) < rank(batchVerdict)) batchVerdict = VERDICT_STRENGTH[rank(verdict)];
    if (quietTimer !== null) timers.clearTimeout(quietTimer);
    quietTimer = timers.setTimeout(emitReload, RELOAD_QUIET_MS);
    if (capTimer === null) capTimer = timers.setTimeout(emitReload, RELOAD_MAX_HOLD_MS);
  }

  const es = new EventSourceCtor(eventsUrl);

  // The `hello` frame fires on every (re)connect and carries the server's
  // per-process boot id (#893). A full server restart (Node's `node --watch`)
  // drops this connection, and if the in-process rebuild's `reload` frame was
  // killed with the old process no reload was delivered, so the edit would need
  // a MANUAL refresh. The browser auto-reconnects to the FRESH process, whose
  // boot id differs, so a CHANGED id is the edit signal: broadcast a reload (the
  // tab still gates it on a readiness probe). A transient reconnect (sleep/wake,
  // a network blip, a tab evicted at the HTTP/1.1 cap) reconnects to the SAME
  // process with the SAME id, so it never reloads. The first `hello` only
  // records the baseline. Both reload paths route through the ONE debounced
  // emitter above (#1397), since a burst of edits produces one signal of each
  // kind per save.
  //
  // A changed boot id is unconditionally a FULL RELOAD (#1398), and it is NOT a
  // "no verdict" signal to be overridden by a lighter one already in the batch.
  // A restart carries no filename, so nothing survives it to classify, and a
  // burst can hold a page edit whose in-process frame was delivered next to a
  // component edit whose frame died with the old process. In that burst the
  // changed boot id is the component edit's ONLY trace.
  es.addEventListener('hello', (e) => {
    if (lastBoot !== null && e.data !== lastBoot) requestReload('reload');
    lastBoot = e.data;
  });

  // The cached error is cleared IMMEDIATELY, not on the debounced emit: a tab
  // connecting during the pending window must not be replayed an overlay for an
  // error the rebuild already fixed. `webjs-error` itself stays undebounced,
  // since an overlay has to appear at once and it is not a reload.
  es.addEventListener('reload', (e) => { lastError = null; requestReload(parseVerdict(e.data)); });
  es.addEventListener('webjs-error', (e) => { lastError = e.data; fanout({ type: 'webjs-error', data: e.data }); });

  scope.onconnect = (e) => {
    const port = e.ports[0];
    ports.add(port);
    port.start();
    // A tab that connects AFTER a breaking edit still needs the current overlay.
    // The single shared EventSource already consumed the server's replay (#264),
    // so the worker caches the last error and hands it to each new tab itself.
    if (lastError != null) {
      try { port.postMessage({ type: 'webjs-error', data: lastError }); } catch (_) { ports.delete(port); }
    }
  };

  // Returned for tests; the served worker ignores it.
  return { ports, es };
}
