/**
 * Shared navigation guard for browser tests (#1135). Sibling of
 * `test/browser-assert.js` (#777) and with the same "one source of truth for
 * browser tests" role.
 *
 * The problem it solves: web-test-runner aborts the ENTIRE session, not one
 * file, when the page navigates. A browser test that clicks a real `<a href>`
 * or submits a real `<form>` is therefore a single point of failure for all 60+
 * browser test files. Whenever the router loses the race to intercept (a slower
 * engine, a slow module load, an unlucky tick), the browser performs the real
 * navigation and the run dies with `0 failed` plus exit 1, which reads as an
 * infrastructure blip rather than a test problem.
 *
 * This cancels the browser's default activation while leaving the router fully
 * exercised, so an interception gap FAILS one test on its own assertion
 * instead of taking down the run.
 *
 * It is opt-in PER SUITE, not global, so a new suite that clicks a real link or
 * submits a real form has to install it. A pure-fragment `href="#x"` link needs
 * no guard, since it never navigates the page away.
 *
 * ## The phase is load-bearing: `window`, BUBBLE, never capture
 *
 * The router registers its `click` / `submit` listeners on `document` in the
 * bubble phase (`packages/core/src/router-client.js`), and returns immediately
 * when `e.defaultPrevented` is already set (the `#150` / `#153` contract: a
 * component's own `@click` must be able to opt out).
 *
 * `window` bubble is the LAST step of the propagation path, so it runs after
 * every document-level listener, and `preventDefault()` still cancels the
 * default action because that action runs only once dispatch completes. It also
 * needs no registration-order contract with `enableClientRouter()`.
 *
 * A CAPTURE-phase guard would set `defaultPrevented` BEFORE the router ever saw
 * the event, so every guarded router test would silently stop testing the
 * router while still passing. That is a silent no-op, which is the worst
 * possible failure here, and it is why `nav-guard.test.js` asserts the router
 * still ran rather than trusting this by inspection.
 *
 * ## What it cannot do
 *
 * It cannot stop the router's own `location.href` assignment on a degradation:
 * `preventDefault` cancels a default action, not a script assignment. The
 * `fallbacks` array is the coverage for that second channel. Every reload site
 * dispatches `webjs:navigation-fallback` with a stable `cause` immediately
 * beforehand, so a test asserts `fallbacks` is empty and names the cause.
 * Removing the conditions that cause a degradation is the fixture work in
 * #1053.
 *
 * @returns {{ fallbacks: Array<{cause: string, href: string, willReload: boolean}>, remove: () => void }}
 */
export function installNavGuard() {
  /** @type {Array<{cause: string, href: string, willReload: boolean}>} */
  const fallbacks = [];

  const onClick = (e) => {
    // Walk the COMPOSED path, exactly as the router's `findAnchorInPath` does,
    // rather than `e.target.closest('a[href]')`. This listener is on `window`,
    // so a click originating inside an open shadow root arrives retargeted to
    // the shadow HOST, and `closest()` walks only light-tree ancestors and
    // never finds the anchor. The guard would then fail open for a
    // `static shadow = true` component rendering a link, which is precisely a
    // case the router itself handles, so the backstop must not be narrower
    // than the thing it backstops.
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    for (const el of path) {
      if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) { e.preventDefault(); return; }
    }
  };

  // Forms need the `submit` event, NOT the click on the submit control. The
  // form's default action fires on submit, and cancelling the button's click
  // would stop the form from ever submitting, so the router's own submit
  // listener would never run and the test would assert nothing.
  const onSubmit = (e) => { e.preventDefault(); };

  const onFallback = (e) => { fallbacks.push(e.detail); };

  window.addEventListener('click', onClick);
  window.addEventListener('submit', onSubmit);
  document.addEventListener('webjs:navigation-fallback', onFallback);

  return {
    fallbacks,
    remove() {
      window.removeEventListener('click', onClick);
      window.removeEventListener('submit', onSubmit);
      document.removeEventListener('webjs:navigation-fallback', onFallback);
    },
  };
}
