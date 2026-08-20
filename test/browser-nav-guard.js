import { _setHardNavigate } from '../packages/core/src/router-client.js';

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
 * submits a real form has to install it.
 *
 * ## What it deliberately does NOT cancel: a same-document fragment link
 *
 * A link whose origin, pathname and query match the page it sits on, and which
 * carries a fragment, does not navigate the page away: the browser scrolls to
 * the target and fires `popstate`, and the session survives. So there is
 * nothing here to guard against, and cancelling it does real harm, because
 * `preventDefault` is exactly what suppresses that native jump. A suite testing
 * the router's own fragment bow-out (#1437) would then see no jump at all and
 * could not tell a working bow-out from a broken one.
 *
 * The test is `href`-based rather than `hash`-based for the same reason the
 * router's is: the URL serializer reports a null fragment and an EMPTY one
 * identically as `''`, and `href="#"` is a real fragment navigation, to the
 * document element. `href=""` carries no fragment at all, resolves to the
 * current url with the fragment removed, and the spec RELOADS it, so it is a
 * genuine session risk and stays guarded.
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
 * ## The second channel: the router's own hard navigation
 *
 * `preventDefault` cancels a default action, not a script assignment, so it can
 * never stop the router assigning `location.href` when it degrades. That is a
 * separate channel and it needs a separate mechanism: the router routes every
 * hard navigation through one `_setHardNavigate` seam (#1286), and this installs an override that
 * RECORDS the attempt into `hardNavigations` instead of performing it. So a
 * degradation now fails the one test with a readable message instead of
 * aborting the whole session.
 *
 * Intercepting `location.href` directly is not an option and should not be
 * attempted: it is non-configurable on all three engines, so its setter cannot
 * be redefined. That is why the seam lives in the router rather than here.
 *
 * `fallbacks` stays useful alongside it: it carries the stable `cause` slug
 * that says WHY the router degraded, which the recorded href alone does not.
 *
 * This catches one navigation that is NOT a degradation: a cross-origin
 * `navigate()`, which is an intentional full-page nav. It is recorded rather
 * than performed like any other, so it is observable (assert on
 * `hardNavigations`) instead of ending the session. Nothing is swallowed
 * silently; a suite asserting `hardNavigations` is empty will fail on it.
 *
 * Note this module imports the router, which self-enables on load. Every suite
 * that installs the guard is already a router suite that imports it, so this
 * changes nothing in practice.
 *
 * @returns {{ fallbacks: Array<{cause: string, href: string, willReload: boolean}>, hardNavigations: string[], remove: () => void }}
 */
/**
 * Whether this href is a same-document fragment jump, which the guard leaves
 * alone (see the header note). Mirrors the router's own bow-out predicate in
 * `packages/core/src/router-client/events.js`.
 *
 * @param {string} href Absolute, as `HTMLAnchorElement.href` always is.
 * @returns {boolean}
 */
function isSameDocumentFragment(href) {
  let url;
  try { url = new URL(href); } catch { return false; }
  if (url.origin !== location.origin) return false;
  if (url.pathname !== location.pathname || url.search !== location.search) return false;
  return url.href.includes('#');
}

export function installNavGuard() {
  /** @type {Array<{cause: string, href: string, willReload: boolean}>} */
  const fallbacks = [];
  /** @type {string[]} */
  const hardNavigations = [];

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
      if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) {
        if (isSameDocumentFragment(el.href)) return;
        e.preventDefault();
        return;
      }
    }
  };

  // Forms need the `submit` event, NOT the click on the submit control. The
  // form's default action fires on submit, and cancelling the button's click
  // would stop the form from ever submitting, so the router's own submit
  // listener would never run and the test would assert nothing.
  const onSubmit = (e) => { e.preventDefault(); };

  const onFallback = (e) => { fallbacks.push(e.detail); };

  // Record the router's own hard navigations instead of performing them.
  _setHardNavigate((href) => { hardNavigations.push(String(href)); });

  window.addEventListener('click', onClick);
  window.addEventListener('submit', onSubmit);
  document.addEventListener('webjs:navigation-fallback', onFallback);

  return {
    fallbacks,
    hardNavigations,
    remove() {
      _setHardNavigate(null);
      window.removeEventListener('click', onClick);
      window.removeEventListener('submit', onSubmit);
      document.removeEventListener('webjs:navigation-fallback', onFallback);
    },
  };
}
