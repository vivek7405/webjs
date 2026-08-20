/**
 * Real-browser hydration guard for `live()` in an attribute hole (#1443).
 *
 * The unit tests assert the SSR STRING. This asserts what a reader actually
 * saw: a component binding `?open=${live(false)}` was served with `open=""`, so
 * the browser painted the region OPEN and hydration then removed the attribute
 * and collapsed it. On webjs.dev that was the mobile nav menu flashing open on
 * every page load.
 *
 * A string comparison cannot catch that class of bug alone, because a server
 * that emits the attribute and a client that removes it are each internally
 * consistent; the defect is the TRANSITION between them. So the assertion is a
 * MutationObserver over the attribute across the hydration window: a correct
 * hydration touches `open` zero times, because SSR never wrote it.
 *
 * The window is opened faithfully. The component's real SSR bytes are built
 * into a DETACHED container (a custom element does not upgrade until it is
 * connected), the observer starts, and only then is the container appended,
 * which is the parse-then-upgrade sequence a served page actually takes and the
 * exact interval the flash lives in.
 */
import { html } from '../../../src/html.js';
import { WebComponent, prop } from '../../../src/component.js';
import { renderToString } from '../../../src/render-server.js';
import { live } from '../../../src/directives.js';

import { assert } from '../../../../../test/browser-assert.js';

/** The shape webjs.dev's nav menu used: a `<details>` bound through live(). */
class MenuProbe extends WebComponent({ open: prop(Boolean) }) {
  constructor() { super(); this.open = false; }
  render() { return html`<details ?open=${live(this.open)}><summary>menu</summary></details>`; }
}
MenuProbe.register('lah-menu');

/** Same, but open by default, so the guard cannot be met by never emitting. */
class OpenProbe extends WebComponent({ open: prop(Boolean) }) {
  constructor() { super(); this.open = true; }
  render() { return html`<details ?open=${live(this.open)}><summary>menu</summary></details>`; }
}
OpenProbe.register('lah-open');

/**
 * Mount `ssr` through a real upgrade and report every `open` attribute change
 * that happened along the way.
 *
 * Detached first so nothing upgrades before the observer is watching; settled
 * afterwards through the element's own update cycle AND a task turn, so a late
 * write (which is what the flash is) has genuinely had its chance to land
 * before the record is read. Reading earlier would pass vacuously.
 *
 * @returns {Promise<{ host: Element, writes: (string|null)[] }>}
 */
async function hydrate(ssr) {
  const host = document.createElement('div');
  host.innerHTML = ssr;

  /** @type {(string|null)[]} */
  const writes = [];
  const observer = new MutationObserver((records) => {
    for (const r of records) if (r.attributeName === 'open') writes.push(r.oldValue);
  });
  observer.observe(host, { attributes: true, subtree: true, attributeOldValue: true, attributeFilter: ['open'] });

  document.body.appendChild(host);
  const el = host.firstElementChild;
  if (el && /** @type any */ (el).updateComplete) await /** @type any */ (el).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  observer.disconnect();

  return { host, writes };
}

suite('live() in an attribute hole hydrates without a flash (#1443)', () => {
  /** @type {Element[]} */
  let mounted;

  setup(() => { mounted = []; });
  teardown(() => { for (const h of mounted) h.remove(); });

  test('a falsy ?bool bound through live() is absent from SSR and untouched on upgrade', async () => {
    const ssr = await renderToString(html`<lah-menu></lah-menu>`);
    assert.ok(
      !/\bopen[\s=>]/.test(ssr),
      `SSR must not write the attribute for a falsy live() bool, got ${ssr}`,
    );

    const { host, writes } = await hydrate(ssr);
    mounted.push(host);

    const details = host.querySelector('details');
    assert.ok(details, 'the details element survived hydration');
    assert.ok(!details.hasAttribute('open'), 'the hydrated DOM is still closed');
    // Before the fix the SSR bytes carried `open=""` and this recorded exactly
    // one removal, which IS the visible flash.
    assert.equal(
      writes.length,
      0,
      `hydration must not touch the open attribute, but it changed ${writes.length} time(s): ${JSON.stringify(writes)}`,
    );
  });

  test('a truthy ?bool bound through live() is written at SSR and left alone on upgrade', async () => {
    const ssr = await renderToString(html`<lah-open></lah-open>`);
    assert.match(ssr, /\bopen=""/, `SSR must write the attribute for a truthy live() bool, got ${ssr}`);

    const { host, writes } = await hydrate(ssr);
    mounted.push(host);

    assert.ok(host.querySelector('details').hasAttribute('open'), 'the hydrated DOM is still open');
    assert.equal(writes.length, 0, `hydration must not touch the open attribute, got ${JSON.stringify(writes)}`);
  });

  test('a plain attribute bound through live() carries its value into the live DOM', async () => {
    // The `[object Object]` half of the same bug. It is inert (no flash), so
    // only the rendered value shows it, and it is asserted in the DOM rather
    // than the string so a browser re-parse cannot hide it.
    const ssr = await renderToString(html`<div title=${live('hello')}></div>`);
    const host = document.createElement('div');
    host.innerHTML = ssr;
    document.body.appendChild(host);
    mounted.push(host);

    assert.equal(
      host.querySelector('div').getAttribute('title'),
      'hello',
      'the live() wrapper must not reach the attribute value',
    );
  });
});
