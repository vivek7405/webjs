/**
 * Browser tests for overlay Tier-2 @webjsdev/ui custom elements: dialog,
 * popover, tooltip, dropdown-menu. Runs in real Chromium via WTR + Playwright.
 *
 * API conventions across all four (mirror what they actually implement, not
 * what shadcn's React API looks like):
 *   - `el.isOpen`: boolean getter (popover, dialog, tooltip). For dropdown-
 *     menu and collapsible the state lives on the `open` HTML attribute, so
 *     `el.hasAttribute('open')` is the canonical read.
 *   - `el.show()` / `el.hide()` / `el.toggle()`: programmatic control.
 *   - Event `ui-open-change` with `detail: { open }`: fires from dialog,
 *     popover, and collapsible. Tooltip and dropdown-menu do NOT emit this
 *     today, so tests for those use post-action state assertions instead.
 *   - Content is rendered INLINE as `:scope > ui-X-content` (not portaled to
 *     document.body). Visibility is controlled by CSS:
 *     `ui-X:not([open]) ui-X-content { display: none !important; }`. So
 *     queries always go through the host element / root, not document.body.
 */
import { html } from '../../../../core/src/html.js';
import { render } from '../../../../core/src/render-client.js';

import { assert } from '../../../../../test/browser-assert.js';

const COMPONENTS_DIR = '/packages/ui/packages/registry/components';

const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function mount(tpl) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(tpl, root);
  await tick();
  return root;
}

suite('ui-dialog', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/dialog.ts`);
  });

  test('trigger click opens dialog', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>Open</button></ui-dialog-trigger>
        <ui-dialog-content>
          <ui-dialog-title>T</ui-dialog-title>
          <ui-dialog-description>D</ui-dialog-description>
        </ui-dialog-content>
      </ui-dialog>
    `);
    // Click the inner wrapper that <ui-dialog-trigger> renders (where
    // @click is bound). The user-authored <button> is projected through
    // the slot inside it; clicking either bubbles into the @click
    // handler on the wrapper.
    root.querySelector('ui-dialog-trigger [data-slot="dialog-trigger"]').click();
    await tick();
    const dialog = root.querySelector('ui-dialog');
    assert.equal(dialog.isOpen, true, 'dialog.isOpen=true after trigger click');
    const inner = dialog.querySelector('[data-slot="dialog"]');
    assert.equal(inner.getAttribute('data-state'), 'open');
    dialog.hide();
    root.remove();
  });

  test('native close event on the inner <dialog> closes the host (escape path)', async () => {
    // The WebComponent dialog wires the host's open state to the native
    // <dialog> element's `close` event. In a real browser, pressing Escape
    // while the modal is open fires `cancel` then `close` on the native
    // dialog. We simulate that final close (the UA-internal step) by
    // dispatching a synthetic close event on the native dialog element.
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>Open</button></ui-dialog-trigger>
        <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
      </ui-dialog>
    `);
    const dialog = root.querySelector('ui-dialog');
    dialog.show();
    await tick();
    const nativeDialog = dialog.querySelector('dialog[data-slot="dialog-native"]');
    nativeDialog.dispatchEvent(new Event('close'));
    await tick();
    assert.equal(dialog.isOpen, false, 'host closes when native dialog fires close');
    root.remove();
  });

  test('fires ui-open-change event when toggling', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>Open</button></ui-dialog-trigger>
        <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
      </ui-dialog>
    `);
    const dialog = root.querySelector('ui-dialog');
    let detail = null;
    dialog.addEventListener('ui-open-change', (e) => { detail = e.detail; });
    dialog.show();
    await tick();
    assert.equal(detail?.open, true);
    dialog.hide();
    await tick();
    assert.equal(detail?.open, false);
    root.remove();
  });

  test('dialog-content has data-state="closed" when host is not open', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>O</button></ui-dialog-trigger>
        <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
      </ui-dialog>
    `);
    await tick();
    const dialog = root.querySelector('ui-dialog');
    // data-state lives on the inner content div rendered inside the
    // <ui-dialog-content> host. Located by its data-slot, NOT by [role="dialog"]:
    // the role moved onto the native <dialog> in #1245, and the two were only
    // ever on the same element by coincidence. data-state is a styling hook and
    // the role is an accessibility contract, so a locator that conflates them
    // breaks whenever either one moves.
    const contentInner = dialog.querySelector('ui-dialog-content [data-slot="dialog-content"]');
    assert.ok(contentInner, 'inner content element exists in DOM');
    assert.equal(contentInner.getAttribute('data-state'), 'closed');
    // Re-pointing the locator above removed this file's only implicit proof
    // that the role exists at all, so assert it directly on the element that
    // owns it. Otherwise the dialog could lose its role entirely and every
    // browser-layer test here would still pass.
    const nativeDialog = dialog.querySelector('dialog[data-slot="dialog-native"]');
    assert.equal(nativeDialog.getAttribute('role'), 'dialog', 'native <dialog> carries role=dialog');
    assert.equal(contentInner.hasAttribute('role'), false, 'and the content panel carries no second dialog role');
    assert.equal(getComputedStyle(dialog.querySelector('ui-dialog-content')).display, 'none', 'host hidden when closed');
    root.remove();
  });
});

// --------------------------------------------------------------------------
// Scroll lock layout (#1144)
//
// Locking body scroll hides the page scrollbar, which widens the viewport by
// the scrollbar's width. Padding the body holds in-flow content still, but a
// `position: fixed` header lays out against the initial containing block, so
// it used to slide right by half the scrollbar width.
//
// These assertions are only meaningful where the scrollbar takes LAYOUT WIDTH.
// Headless browsers default to overlay scrollbars (zero width), which makes the
// whole scenario inert, so `buildFixedHeaderPage()` styles the root scrollbar to
// force a classic one and `requireClassicScrollbar()` decides what a zero width
// means: a genuine overlay-only engine skips, Chromium fails (its scrollbar is
// guaranteed by the WTR config), and a lock leaked by an earlier test fails
// everywhere. A silent pass here would prove nothing, so none is reachable.
// --------------------------------------------------------------------------

const scrollbarWidth = () => window.innerWidth - document.documentElement.clientWidth;

/**
 * Gate a scroll-lock assertion on a scrollbar that actually takes layout width.
 *
 * Skipping is correct on an engine whose scrollbars are always overlay (Firefox
 * on Linux cannot be forced off them). It is NOT correct on Chromium, where the
 * root WTR config drops Playwright's `--hide-scrollbars` precisely so this suite
 * has a real scrollbar: a zero width there means that flag stopped working and
 * the whole suite would otherwise go silently green while asserting nothing.
 */
function requireClassicScrollbar(ctx) {
  // A lock leaked by an earlier test hides the scrollbar, which is
  // indistinguishable from an overlay-scrollbar engine and would silently skip.
  // Fail instead, on every engine: a leak is the failure, not a reason to stop
  // looking for one.
  assert.equal(document.body.style.overflow, '', 'the page arrived with no lock left over');
  if (scrollbarWidth() > 0) return true;
  const ua = navigator.userAgent;
  const isChromium = ua.includes('Chrome/') && !ua.includes('Edg/');
  assert.equal(
    isChromium,
    false,
    'Chromium reported a zero-width scrollbar: the --hide-scrollbars opt-out in ' +
      'web-test-runner.config.js is no longer taking effect, so these assertions ' +
      'would pass without testing anything',
  );
  ctx.skip();
  return false;
}

/**
 * Build the reproduction: a page that overflows, a fixed full-width header with
 * a centred inner box (the thing that visibly jumped), and a centred in-flow
 * box (which must not move either). The header opts into the published
 * compensation, which is a no-op on engines that hold the viewport width via
 * the reserved gutter.
 *
 * Centres are what matter here. The body's own border box legitimately widens
 * when the compensation path runs (padding holds the CONTENT still, not the
 * border box), so measuring the body would report a false shift.
 */
async function buildFixedHeaderPage(rootStyles = {}) {
  const style = document.createElement('style');
  style.textContent =
    'html::-webkit-scrollbar { width: 15px; background: #eee; }' +
    'html::-webkit-scrollbar-thumb { background: #888; }';
  document.head.appendChild(style);

  const spacer = document.createElement('div');
  spacer.style.height = '300vh';
  document.body.appendChild(spacer);

  const flow = document.createElement('div');
  flow.style.cssText = 'max-width:400px;margin:0 auto;height:20px;';
  document.body.appendChild(flow);

  // The opt-in is the shape every doc surface prescribes: a transparent right
  // border on the element that is both viewport-width and painting. Padding was
  // the earlier form and is deliberately NOT what is asserted here.
  const header = document.createElement('div');
  header.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:40px;background:#345;' +
    'border-right:var(--wj-scrollbar-compensation, 0px) solid transparent;';
  // Mirrors the real site's shape, because the shape is what the placement bug
  // turned on: a viewport-width painting header, wrapping a `max-width` centring
  // bar, holding a leading child and a `flex: 1` centred region.
  //
  // That flex-1 region is why BOTH probes are needed, and it is the detail an
  // earlier version of this fixture got wrong. Insetting the bar shrinks the
  // flex-1 region, which pulls its centred content back to where it started, so
  // the centred probe reports no movement. The leading child is `flex: none` and
  // rides the bar's own shift, so it keeps moving. That is exactly the wrong
  // placement that reached review, and the leading probe is the ONLY thing here
  // that catches it. Measured at a 1000px viewport with a 15px scrollbar:
  //
  //   opt-in       leading   centred
  //   none           +7.5      +7.5
  //   on the bar     +7.5       0.0   <- the wrong placement, centred probe blind
  //   on the header   0.0       0.0   <- what ships
  //
  // `box-sizing: border-box` on the bar is load-bearing too and must be explicit:
  // the WTR page ships no reset, and under content-box `max-width` caps the
  // CONTENT box, so a right border grows the border box instead of insetting the
  // content and the leading probe goes inert. The live sites get border-box from
  // Tailwind's preflight, so this matches them.
  const bar = document.createElement('div');
  bar.style.cssText =
    'box-sizing:border-box;max-width:400px;margin:0 auto;height:40px;display:flex;';
  const leading = document.createElement('div');
  leading.style.cssText = 'width:20px;height:40px;flex:none;';
  const nav = document.createElement('div');
  nav.style.cssText = 'flex:1;display:flex;justify-content:center;';
  const inner = document.createElement('div');
  inner.style.cssText = 'width:40px;height:40px;';
  const trailing = document.createElement('div');
  trailing.style.cssText = 'width:20px;height:40px;flex:none;';
  nav.appendChild(inner);
  bar.appendChild(leading);
  bar.appendChild(nav);
  bar.appendChild(trailing);
  header.appendChild(bar);
  document.body.appendChild(header);

  // WebKit only materialises a custom root scrollbar after a layout pass, so
  // the precondition check has to wait or it under-reports the width.
  await tick();

  // Applied here, and restored in teardown AFTER the unlock has run, because
  // `hide()` defers unlockScroll() to a microtask: resetting these in a test's
  // own `finally` would run first and the unlock would then write the app's
  // values straight back onto <html> with nothing left to clear them.
  const savedRoot = {};
  for (const [prop, value] of Object.entries(rootStyles)) {
    savedRoot[prop] = document.documentElement.style[prop];
    document.documentElement.style[prop] = value;
  }

  const mounted = [];

  return {
    header,
    inner,
    leading,
    flow,
    /** Track a mounted root so teardown can unmount it even after a failure. */
    track(root) {
      mounted.push(root);
      return root;
    },
    async teardown() {
      // Close every dialog FIRST, and WAIT for the unlock. An assertion that
      // throws mid-test would otherwise leave the lock engaged, and the next
      // test would see a page with no scrollbar and skip itself instead of
      // running. hide() only queues the unlock, so the await is load-bearing.
      for (const root of mounted) {
        for (const el of root.querySelectorAll('ui-dialog, ui-alert-dialog')) el.hide?.();
      }
      await tick();
      for (const root of mounted) root.remove();
      style.remove();
      spacer.remove();
      flow.remove();
      header.remove();
      for (const [prop, value] of Object.entries(savedRoot)) {
        document.documentElement.style[prop] = value;
      }
    },
  };
}

const centreOf = (el) => {
  const b = el.getBoundingClientRect();
  return Math.round((b.left + b.width / 2) * 100) / 100;
};
const rightEdgeOf = (el) => Math.round(el.getBoundingClientRect().right * 100) / 100;

suite('ui-dialog scroll lock layout', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/dialog.ts`);
  });

  // A dialog whose own content scrolls is the case where the two scrollbars could
  // interact: the page's is being removed at the same moment the dialog's appears.
  // The residual is measured off the ROOT element's box, which a scrollbar inside
  // the top layer does not touch, so the two should be independent. Asserting it
  // rather than assuming it, and asserting the dialog stays scrollable, since a
  // scroll lock that also froze the dialog would be a worse bug than the shift.
  test('a dialog whose own content scrolls does not disturb the compensation', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;

      const root = page.track(
        await mount(html`
          <ui-dialog>
            <ui-dialog-content>
              <ui-dialog-title>Tall</ui-dialog-title>
              <div style="height:3000px"></div>
            </ui-dialog-content>
          </ui-dialog>
        `),
      );
      const dialog = root.querySelector('ui-dialog');
      const fixedBefore = centreOf(page.inner);
      const leadingBefore = centreOf(page.leading);
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();

      assert.equal(document.body.style.overflow, 'hidden', 'the lock engaged');
      assert.equal(centreOf(page.inner), fixedBefore, 'centred header content does not move');
      assert.equal(centreOf(page.leading), leadingBefore, 'left-aligned header content does not move');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move');

      // The dialog's content really does overflow, so this is not a vacuous pass.
      const native = dialog.querySelector('dialog[data-slot="dialog-native"]');
      const panel = dialog.querySelector('[data-slot="dialog"]');
      const scroller = [native, panel].find((el) => el && el.scrollHeight > el.clientHeight);
      assert.ok(scroller, 'the tall dialog actually overflows somewhere');

      // And it is still scrollable while the page underneath is locked.
      scroller.scrollTop = 200;
      assert.ok(scroller.scrollTop > 0, 'the dialog still scrolls while the page is locked');

      dialog.hide();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'centred content back where it started');
      assert.equal(centreOf(page.leading), leadingBefore, 'left-aligned content back where it started');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation released',
      );
      assert.equal(document.documentElement.style.paddingRight, '', 'no padding left behind');
    } finally {
      await page.teardown();
    }
  });

  test('opening a dialog leaves a position:fixed header exactly where it was', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;

      const root = page.track(await mount(html`
        <ui-dialog>
          <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
      `));
      const dialog = root.querySelector('ui-dialog');

      const fixedBefore = centreOf(page.inner);
      const leadingBefore = centreOf(page.leading);
      const flowBefore = centreOf(page.flow);
      const chromeBefore = rightEdgeOf(page.header);
      assert.equal(chromeBefore, rightEdgeOf(document.documentElement), 'chrome starts full width');

      dialog.show();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'the lock engaged');

      assert.equal(centreOf(page.inner), fixedBefore, 'centred header content does not move on open');
      assert.equal(
        centreOf(page.leading),
        leadingBefore,
        'left-aligned header content does not move on open either',
      );
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move on open');
      // The chrome must still reach the edge of the initial containing block. An
      // opt-in that holds the content by shrinking the PAINTED box would satisfy
      // the assertions above and leave an unpainted strip. Compared against the
      // root's own box, which tracks the ICB, so this holds on both paths: where
      // the gutter is reserved nothing moved at all, and where it is not, both
      // edges grew together.
      assert.equal(
        rightEdgeOf(page.header),
        rightEdgeOf(document.documentElement),
        'the painted chrome still spans the full viewport',
      );

      dialog.hide();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'centred header content does not move on close');
      assert.equal(centreOf(page.leading), leadingBefore, 'left-aligned content does not move on close');
    } finally {
      await page.teardown();
    }
  });

  test('the lock is released cleanly, leaving no compensation behind', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;

      const root = page.track(await mount(html`
        <ui-dialog>
          <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
      `));
      const dialog = root.querySelector('ui-dialog');

      dialog.show();
      await tick();
      dialog.hide();
      await tick();

      assert.equal(document.body.style.overflow, '', 'body overflow restored');
      assert.equal(document.documentElement.style.paddingRight, '', 'root padding restored');
      assert.equal(document.documentElement.style.scrollbarGutter, '', 'scrollbar gutter restored');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation custom property cleared',
      );
    } finally {
      await page.teardown();
    }
  });

  // dialog.ts and alert-dialog.ts ship as separate copies (so
  // `webjs ui add alert-dialog` stays self contained) but share ONE refcount
  // through globalThis, so a confirm opened from inside a dialog is a plain
  // increment and its close a plain decrement. This is the interleaving that
  // duplication creates, and the assertion is that the shared count holds
  // through it.
  test('an alert-dialog inside an open dialog does not release the dialog compensation', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;
      await import(`${COMPONENTS_DIR}/alert-dialog.ts`);

      const root = page.track(
        await mount(html`
          <ui-dialog>
            <ui-dialog-content><ui-dialog-title>Outer</ui-dialog-title></ui-dialog-content>
          </ui-dialog>
          <ui-alert-dialog>
            <ui-alert-dialog-content><ui-alert-dialog-title>Confirm</ui-alert-dialog-title></ui-alert-dialog-content>
          </ui-alert-dialog>
        `),
      );
      const dialog = root.querySelector('ui-dialog');
      const confirm = root.querySelector('ui-alert-dialog');

      const fixedBefore = centreOf(page.inner);
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();
      const compensationWithDialog = document.documentElement.style.getPropertyValue(
        '--wj-scrollbar-compensation',
      );

      confirm.show();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header held with the confirm open');

      confirm.hide();
      await tick();
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        compensationWithDialog,
        'closing the confirm leaves the dialog compensation as it was',
      );
      assert.equal(document.body.style.overflow, 'hidden', 'still locked, the dialog is open');
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header held after the confirm closes');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content held after the confirm closes');

      dialog.hide();
      await tick();
      assert.equal(document.body.style.overflow, '', 'released on the outermost close');
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header back where it started');
    } finally {
      await page.teardown();
    }
  });

  // Release order is NOT guaranteed to be LIFO: disconnectedCallback fires in
  // tree order and the before-cache close runs in registration order, so an
  // outer dialog can release before an inner confirm that is still open. With a
  // refcount per module the inner unlock then re-applies what it captured, with
  // nothing left to clear it, and <html> stays padded for the rest of the
  // session. One shared refcount is what makes the order irrelevant.
  test('releasing the outer dialog first still leaves the page clean', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;
      await import(`${COMPONENTS_DIR}/alert-dialog.ts`);

      const root = page.track(
        await mount(html`
          <ui-dialog>
            <ui-dialog-content><ui-dialog-title>Outer</ui-dialog-title></ui-dialog-content>
          </ui-dialog>
          <ui-alert-dialog>
            <ui-alert-dialog-content><ui-alert-dialog-title>Confirm</ui-alert-dialog-title></ui-alert-dialog-content>
          </ui-alert-dialog>
        `),
      );
      const dialog = root.querySelector('ui-dialog');
      const confirm = root.querySelector('ui-alert-dialog');
      const fixedBefore = centreOf(page.inner);

      dialog.show();
      await tick();
      confirm.show();
      await tick();

      // Outer first, the order the DOM actually gives us on a subtree removal.
      dialog.hide();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'still locked, the confirm is open');
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header still held');

      confirm.hide();
      await tick();
      assert.equal(document.body.style.overflow, '', 'overflow released');
      assert.equal(document.documentElement.style.paddingRight, '', 'no padding left on the page');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'no compensation left on the page',
      );
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header back where it started');
    } finally {
      await page.teardown();
    }
  });

  // A dialog with no content child returns from _setup() BEFORE locking, so it
  // must not release anything on the way out. It used to: _teardown() unlocked
  // unconditionally, which consumed the OPEN dialog's refcount and restored the
  // page mid-flight, dropping its compensation.
  //
  // What this pins is the `_scrollLocked` guard in _teardown(). The count-zero
  // early return in unlockScroll() is now belt-and-braces rather than the thing
  // under test, because no path through the components can reach unlockScroll
  // with a zero count any more. Deleting that early return would leave this
  // green, and that is expected.
  test('a contentless dialog does not release an open dialog\'s lock', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;

      const root = page.track(
        await mount(html`
          <ui-dialog id="real">
            <ui-dialog-content><ui-dialog-title>Real</ui-dialog-title></ui-dialog-content>
          </ui-dialog>
          <ui-dialog id="contentless"></ui-dialog>
        `),
      );
      const real = root.querySelector('#real');
      const contentless = root.querySelector('#contentless');
      const fixedBefore = centreOf(page.inner);
      const flowBefore = centreOf(page.flow);

      real.show();
      await tick();
      const compensation = document.documentElement.style.getPropertyValue(
        '--wj-scrollbar-compensation',
      );
      const padding = document.documentElement.style.paddingRight;

      // Shown and hidden with no content child, so it never locked.
      contentless.show();
      await tick();
      contentless.hide();
      await tick();

      assert.equal(document.body.style.overflow, 'hidden', 'the open dialog is still locked');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        compensation,
        'the open dialog keeps its compensation',
      );
      assert.equal(document.documentElement.style.paddingRight, padding, 'the padding is untouched');
      assert.equal(centreOf(page.inner), fixedBefore, 'the fixed header does not move');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move');

      real.hide();
      await tick();
      assert.equal(document.body.style.overflow, '', 'released cleanly afterwards');
      assert.equal(document.documentElement.style.paddingRight, '', 'no padding left behind');
    } finally {
      await page.teardown();
    }
  });

  // An app that already reserves both gutters (the standard no-layout-shift
  // technique) keeps them through the lock, so overwriting its choice with the
  // single-edge value would drop one and introduce a shift the page never had.
  test("an app's own scrollbar-gutter is left alone", async function () {
    const page = await buildFixedHeaderPage({ scrollbarGutter: 'stable both-edges' });
    const root = document.documentElement;
    try {
      await tick();
      if (!requireClassicScrollbar(this)) return;

      const mountedRoot = page.track(
        await mount(html`
          <ui-dialog>
            <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
          </ui-dialog>
        `),
      );
      const dialog = mountedRoot.querySelector('ui-dialog');
      const fixedBefore = centreOf(page.inner);
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'the lock engaged');
      assert.equal(
        root.style.scrollbarGutter,
        'stable both-edges',
        "the page's own gutter choice is not overwritten",
      );
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header does not move');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move');

      dialog.hide();
      await tick();
      assert.equal(root.style.scrollbarGutter, 'stable both-edges', 'gutter choice restored');
    } finally {
      await page.teardown();
    }
  });

  // The compensation is ADDED to whatever padding the page already had on the
  // root, not written over it.
  test("an app's own root padding is added to, not replaced", async function () {
    const page = await buildFixedHeaderPage({ paddingRight: '20px' });
    const root = document.documentElement;
    try {
      await tick();
      if (!requireClassicScrollbar(this)) return;

      const mountedRoot = page.track(
        await mount(html`
          <ui-dialog>
            <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
          </ui-dialog>
        `),
      );
      const dialog = mountedRoot.querySelector('ui-dialog');
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'the lock engaged');
      assert.ok(
        parseFloat(getComputedStyle(root).paddingRight) >= 20,
        "the page's own padding is never reduced",
      );
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move');

      dialog.hide();
      await tick();
      assert.equal(root.style.paddingRight, '20px', "the page's own padding is restored exactly");
    } finally {
      await page.teardown();
    }
  });

  test('nested dialogs release the compensation only on the outermost close', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;

      const root = page.track(await mount(html`
        <ui-dialog id="outer">
          <ui-dialog-content><ui-dialog-title>Outer</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
        <ui-dialog id="inner">
          <ui-dialog-content><ui-dialog-title>Inner</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
      `));
      const outer = root.querySelector('#outer');
      const nested = root.querySelector('#inner');

      const fixedBefore = centreOf(page.inner);

      outer.show();
      await tick();
      nested.show();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header held with both dialogs open');

      nested.hide();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'still locked while the outer dialog is open');
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header still held after the nested close');

      outer.hide();
      await tick();
      assert.equal(document.body.style.overflow, '', 'released on the outermost close');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation released on the outermost close',
      );
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header back where it started');
    } finally {
      await page.teardown();
    }
  });
});

suite('ui-tooltip', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/tooltip.ts`);
  });

  // The Lit-idiomatic refactor renders each compound subcomponent's
  // ARIA role + popover element inside its slot output. The host stays
  // a thin wrapper; data-state, role, popover, class all live on the
  // inner rendered element. Tests target the inner element accordingly.

  test('tooltip is closed initially', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>Tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    await tick();
    const tip = root.querySelector('ui-tooltip');
    assert.equal(tip.isOpen, false);
    const inner = tip.querySelector('[data-slot="tooltip"]');
    assert.equal(inner.getAttribute('data-state'), 'closed');
    root.remove();
  });

  test('show() opens the tooltip and reflects via data-state', async () => {
    // `delay-duration="0"` skips the default 700ms open delay so the
    // setTimeout fires effectively immediately.
    const root = await mount(html`
      <ui-tooltip delay-duration="0">
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>Tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    const tip = root.querySelector('ui-tooltip');
    tip.show();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(tip.isOpen, true);
    const inner = tip.querySelector('[data-slot="tooltip"]');
    assert.equal(inner.getAttribute('data-state'), 'open');
    const contentPanel = tip.querySelector('ui-tooltip-content [role="tooltip"]');
    assert.ok(contentPanel, 'tooltip content element rendered');
    root.remove();
  });

  test('mouseleave on trigger closes after open', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>Tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    const tip = root.querySelector('ui-tooltip');
    tip.show();
    await tick();
    // Dispatch on the inner wrapper since that is where @mouseleave is bound.
    const triggerWrapper = root.querySelector('ui-tooltip-trigger [data-slot="tooltip-trigger"]');
    triggerWrapper.dispatchEvent(new Event('mouseleave', { bubbles: true }));
    await tick();
    assert.equal(tip.isOpen, false);
    root.remove();
  });

  test('content has tooltip-content styling classes', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>TipText</ui-tooltip-content>
      </ui-tooltip>
    `);
    const tip = root.querySelector('ui-tooltip');
    tip.show();
    await tick();
    const panel = tip.querySelector('ui-tooltip-content [popover]');
    assert.ok(panel);
    assert.match(panel.className, /bg-foreground/);
    tip.hide();
    root.remove();
  });
});

suite('ui-dropdown-menu', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/dropdown-menu.ts`);
  });

  test('show() opens content and content has role="menu"', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Two</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    assert.ok(dm.hasAttribute('open'));
    const contentInner = dm.querySelector('ui-dropdown-menu-content [role="menu"]');
    assert.ok(contentInner, 'inner role="menu" rendered');
    dm.hide();
    root.remove();
  });

  test('ArrowDown cycles focus across items', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Two</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Three</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    // The focusable target is now the inner [role=menuitem] rendered
    // inside each <ui-dropdown-menu-item> host.
    const items = root.querySelectorAll('ui-dropdown-menu-item [role="menuitem"]');
    assert.ok(items.length >= 2);
    items[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[1]);
    dm.hide();
    root.remove();
  });

  test('focus highlights the item (signal-backed data-highlighted), blur clears it', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Two</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    const items = root.querySelectorAll('ui-dropdown-menu-item [role="menuitem"]');
    assert.ok(items.length >= 2);
    // Highlight rides a local signal -> ?data-highlighted re-render, so it
    // applies after the microtask tick, not synchronously on focus.
    items[0].focus();
    await tick();
    assert.equal(items[0].hasAttribute('data-highlighted'), true, 'focused item is highlighted');
    assert.equal(items[1].hasAttribute('data-highlighted'), false, 'unfocused item is not highlighted');
    // Moving focus to the next item blurs the first and highlights the second.
    items[1].focus();
    await tick();
    assert.equal(items[0].hasAttribute('data-highlighted'), false, 'blurred item clears highlight');
    assert.equal(items[1].hasAttribute('data-highlighted'), true, 'newly focused item is highlighted');
    dm.hide();
    root.remove();
  });

  test('escape closes the dropdown', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    assert.equal(dm.hasAttribute('open'), false);
    root.remove();
  });

  test('clicking an item closes the menu', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    root.querySelector('ui-dropdown-menu-item [role="menuitem"]').click();
    await tick();
    assert.equal(dm.hasAttribute('open'), false);
    root.remove();
  });

  test('trigger click toggles open', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    const trigger = root.querySelector('ui-dropdown-menu-trigger [data-slot="dropdown-menu-trigger"]');
    trigger.click();
    await tick();
    assert.equal(dm.hasAttribute('open'), true);
    trigger.click();
    await tick();
    assert.equal(dm.hasAttribute('open'), false);
    root.remove();
  });
});

suite('ui-alert-dialog', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/alert-dialog.ts`);
  });

  // alert-dialog carries its own copy of the scroll lock (deliberately not
  // imported from dialog.ts, so `webjs ui add alert-dialog` stays self
  // contained), so the #1144 guarantee is asserted against it separately. This
  // is the exact case reported on webjs.dev/ui: the Delete-account demo moved
  // the site's fixed navbar.
  test('opening an alert-dialog leaves a position:fixed header where it was', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (!requireClassicScrollbar(this)) return;

      const root = page.track(await mount(html`
        <ui-alert-dialog>
          <ui-alert-dialog-content><ui-alert-dialog-title>T</ui-alert-dialog-title></ui-alert-dialog-content>
        </ui-alert-dialog>
      `));
      const dialog = root.querySelector('ui-alert-dialog');

      const fixedBefore = centreOf(page.inner);
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'the lock engaged');
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header content does not move on open');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move on open');

      dialog.hide();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header content does not move on close');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation released on close',
      );
    } finally {
      await page.teardown();
    }
  });

  test('trigger click opens via show(); content has role="alertdialog"', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>Delete</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-title>Are you sure?</ui-alert-dialog-title>
          <ui-alert-dialog-cancel><button>Cancel</button></ui-alert-dialog-cancel>
          <ui-alert-dialog-action><button>Delete</button></ui-alert-dialog-action>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    root.querySelector('ui-alert-dialog-trigger [data-slot="alert-dialog-trigger"]').click();
    await tick();
    assert.ok(ad.hasAttribute('open'), 'host gets [open] attribute');
    // Located by data-slot, NOT by [role="alertdialog"]. The role moved onto
    // the native <dialog>, so a role-based locator here would resolve to the
    // same node as `native` below and this would be a weaker duplicate of that
    // assertion rather than a check that the content panel rendered.
    const inner = ad.querySelector('ui-alert-dialog-content [data-slot="alert-dialog-content"]');
    assert.ok(inner, 'inner content panel rendered');
    // showModal() reaches the own-rendered native <dialog> through the
    // ref()/createRef() handle, so the native element is actually open.
    const native = ad.querySelector('dialog[data-slot="alert-dialog-native"]');
    assert.ok(native && native.open, 'ref()-driven showModal opened the native <dialog>');
    // The role lives on the native <dialog>, which is what this test's name is
    // about. Asserted here rather than through a role-based locator, so the
    // check is on the element and cannot quietly become a lookup that passes
    // because it found some other node. This is the browser layer's only
    // assertion of the alertdialog role.
    assert.equal(native.getAttribute('role'), 'alertdialog', 'native <dialog> carries role=alertdialog');
    assert.equal(inner.hasAttribute('role'), false, 'and the content panel carries no second dialog role');
    ad.hide();
    root.remove();
  });

  test('cancel trigger closes the dialog (no escape close, unlike ui-dialog)', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>Delete</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-title>T</ui-alert-dialog-title>
          <ui-alert-dialog-cancel><button>Cancel</button></ui-alert-dialog-cancel>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    ad.show();
    await tick();
    root.querySelector('ui-alert-dialog-cancel [data-slot="alert-dialog-cancel"]').click();
    await tick();
    assert.equal(ad.hasAttribute('open'), false, 'cancel closes');
    root.remove();
  });

  test('action trigger closes the dialog', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>X</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-action><button>Confirm</button></ui-alert-dialog-action>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    ad.show();
    await tick();
    root.querySelector('ui-alert-dialog-action [data-slot="alert-dialog-action"]').click();
    await tick();
    assert.equal(ad.hasAttribute('open'), false);
    root.remove();
  });

  test('content hidden when host has no [open] attribute', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>X</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-title>T</ui-alert-dialog-title>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    const content = ad.querySelector('ui-alert-dialog-content');
    assert.ok(content, 'content stays in DOM when closed');
    assert.equal(getComputedStyle(content).display, 'none', 'CSS hides content when not [open]');
    root.remove();
  });
});

suite('ui-hover-card', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/hover-card.ts`);
  });

  // After the Lit-idiomatic refactor, role + data-state + popover all
  // live on the inner rendered element, not the <ui-*> host.

  test('hover-card is closed initially; data-state="closed"', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><span>Hover me</span></ui-hover-card-trigger>
        <ui-hover-card-content>Profile preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    await tick();
    const hc = root.querySelector('ui-hover-card');
    assert.equal(hc.hasAttribute('open'), false);
    const inner = hc.querySelector('[data-slot="hover-card"]');
    assert.equal(inner.getAttribute('data-state'), 'closed');
    root.remove();
  });

  test('show() with open-delay=0 opens immediately on next macrotask', async () => {
    // Default open-delay is 700ms: too long for a tick(). Set to 0 to
    // make the setTimeout fire on the next macrotask.
    const root = await mount(html`
      <ui-hover-card open-delay="0" close-delay="0">
        <ui-hover-card-trigger><span>x</span></ui-hover-card-trigger>
        <ui-hover-card-content>preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    const hc = root.querySelector('ui-hover-card');
    hc.show();
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(hc.hasAttribute('open'));
    const inner = hc.querySelector('[data-slot="hover-card"]');
    assert.equal(inner.getAttribute('data-state'), 'open');
    hc.hide();
    root.remove();
  });

  test('hide() closes after close-delay', async () => {
    const root = await mount(html`
      <ui-hover-card open-delay="0" close-delay="0">
        <ui-hover-card-trigger><span>x</span></ui-hover-card-trigger>
        <ui-hover-card-content>preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    const hc = root.querySelector('ui-hover-card');
    hc.show();
    await new Promise((r) => setTimeout(r, 5));
    hc.hide();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(hc.hasAttribute('open'), false);
    root.remove();
  });

  test('content has role="dialog" for screen-reader semantics', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><span>x</span></ui-hover-card-trigger>
        <ui-hover-card-content>preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    await tick();
    const panel = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.ok(panel, 'role="dialog" present on rendered inner element');
    root.remove();
  });
});
