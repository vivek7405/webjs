/**
 * SSR-level ARIA assertions for the Tier-2 components (#1080).
 *
 * WHY THIS LAYER EXISTS. The browser suite in
 * `test/components/browser/ui-a11y.test.js` runs only the CLIENT renderer,
 * which REMOVES an attribute whose hole resolved to null
 * (`render-client.js`, `removeAttribute` on a nullish value). The SERVER
 * renderer does not: it stringifies the value, so `aria-label=${null}` ships
 * `aria-label=""`. So a component that "omits" an attribute via a null hole
 * passes a client-side guard while serving markup that carries the empty
 * attribute, and SSR then disagrees with the hydrated DOM on exactly the ARIA
 * the component is responsible for.
 *
 * That is not hypothetical: it is the bug these tests were added for. Any
 * conditional ARIA has to be BRANCHED into the template, and only an assertion
 * against `renderToString` can tell whether it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, '..', 'packages', 'registry', 'components');
const skip = !existsSync(join(COMPONENTS, 'toggle.ts'));

/** Render a template through the SERVER renderer, with components registered. */
async function ssr(load, build) {
  const { renderToString } = await import('@webjsdev/core/server');
  const { html } = await import('@webjsdev/core');
  for (const name of load) await import(join(COMPONENTS, name));
  return renderToString(build(html));
}

test('ui-toggle: a forwarded name lands on the inner button at SSR', { skip }, async () => {
  const out = await ssr(
    ['toggle.ts'],
    (html) => html`<ui-toggle aria-label="Toggle bold"><svg aria-hidden="true"></svg></ui-toggle>`,
  );
  assert.match(out, /<button[^>]*aria-label="Toggle bold"/, 'name is on the button, not just the host');
});

test('ui-toggle: an unlabelled toggle serves NO empty name attributes', { skip }, async () => {
  const out = await ssr(['toggle.ts'], (html) => html`<ui-toggle>Bold</ui-toggle>`);
  // The counterfactual for branching the template: with a single template and
  // null holes, the server emits both of these as empty strings, putting an
  // empty name on the control whose name should come from its slotted text.
  assert.ok(!out.includes('aria-label=""'), `served an empty aria-label: ${out.slice(0, 300)}`);
  assert.ok(
    !out.includes('aria-labelledby=""'),
    `served an empty aria-labelledby (an IDREF list resolving to nothing): ${out.slice(0, 300)}`,
  );
});

test('ui-dropdown-menu-item: a plain item serves no aria-checked at SSR', { skip }, async () => {
  const out = await ssr(
    ['dropdown-menu.ts'],
    (html) => html`<ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>`,
  );
  assert.match(out, /role="menuitem"/, 'it is a plain menuitem');
  // aria-checked is not an allowed attribute on role="menuitem" at all, so an
  // empty one is a defect in the served HTML, not merely untidy.
  assert.ok(!out.includes('aria-checked'), `served aria-checked on a plain menuitem: ${out}`);
  assert.ok(!out.includes('data-state=""'), `served an empty data-state: ${out}`);
});

test('ui-dropdown-menu-item: a checkbox item serves its role + state at SSR', { skip }, async () => {
  const out = await ssr(
    ['dropdown-menu.ts'],
    (html) => html`<ui-dropdown-menu-item type="checkbox" checked>Status</ui-dropdown-menu-item>`,
  );
  assert.match(out, /role="menuitemcheckbox"/, 'checkable role is in the first paint');
  assert.match(out, /aria-checked="true"/, 'and so is the checked state');
});

test('ui-dropdown-menu-item: an unchecked radio item serves aria-checked=false', { skip }, async () => {
  const out = await ssr(
    ['dropdown-menu.ts'],
    (html) => html`<ui-dropdown-menu-item type="radio" value="top">Top</ui-dropdown-menu-item>`,
  );
  assert.match(out, /role="menuitemradio"/);
  assert.match(out, /aria-checked="false"/, 'an explicit false, not an empty value');
});

test('ui-dropdown-menu-group: an unnamed group serves no empty name', { skip }, async () => {
  const out = await ssr(
    ['dropdown-menu.ts'],
    (html) => html`<ui-dropdown-menu-group><span>x</span></ui-dropdown-menu-group>`,
  );
  assert.match(out, /role="group"/);
  assert.ok(!out.includes('aria-label=""'), `served an empty aria-label: ${out}`);
  assert.ok(!out.includes('aria-labelledby=""'), `served an empty aria-labelledby: ${out}`);
});

test('ui-dropdown-menu-group: a named group forwards the name at SSR', { skip }, async () => {
  const out = await ssr(
    ['dropdown-menu.ts'],
    (html) => html`<ui-dropdown-menu-group aria-label="Panel position"><span>x</span></ui-dropdown-menu-group>`,
  );
  assert.match(out, /role="group"[^>]*aria-label="Panel position"/);
});

test('ui-toggle-group-item: disabled state reaches the first paint', { skip }, async () => {
  const out = await ssr(
    ['toggle-group.ts'],
    (html) => html`<ui-toggle-group type="single">
      <ui-toggle-group-item value="a">a</ui-toggle-group-item>
      <ui-toggle-group-item value="b" disabled>b</ui-toggle-group-item>
    </ui-toggle-group>`,
  );
  // aria-disabled is set from render(), which is the only hook SSR runs, so the
  // disabled state must be in the served HTML rather than appearing on hydrate.
  assert.match(out, /aria-disabled="true"/, 'the disabled item is marked before JS loads');
  // ...and the ROLE has to be there too. `aria-pressed` / `aria-disabled` are
  // not global ARIA attributes, so without role="button" the first paint carries
  // attributes that are not allowed on a generic-role element: the same defect
  // class as aria-checked on role="menuitem". The role used to be set only in
  // connectedCallback, which SSR never calls.
  const items = out.match(/<ui-toggle-group-item[^>]*>/g) ?? [];
  assert.ok(items.length >= 2, 'both items rendered');
  for (const tag of items) {
    assert.match(tag, /role="button"/, `served item has no role, so its ARIA is stray: ${tag}`);
    assert.match(tag, /data-slot="toggle-group-item"/, `served item has no data-slot: ${tag}`);
  }
});

// #1245: the dialog-family role moved off the inner content div and onto the
// native <dialog>, so that exactly ONE dialog-family node is exposed in the
// accessibility tree rather than two nested ones (measured over CDP in
// test/e2e/a11y-tree.e2e.mjs). The role is in render(), which is the only hook
// SSR runs, so the FIRST PAINT is where the move has to be visible. These
// assertions are the SSR half of that contract; the tree assertions are the
// half that proves what the platform actually exposes.
test('ui-dialog-content: the role is on the native <dialog> at SSR, not the panel', { skip }, async () => {
  const out = await ssr(
    ['dialog.ts'],
    (html) => html`<ui-dialog-content><h2>Edit profile</h2></ui-dialog-content>`,
  );
  assert.match(
    out,
    /<dialog[^>]*data-slot="dialog-native"[^>]*role="dialog"|<dialog[^>]*role="dialog"[^>]*data-slot="dialog-native"/,
    `the native <dialog> does not carry the role: ${out.slice(0, 400)}`,
  );
  const panel = out.match(/<div[^>]*data-slot="dialog-content"[^>]*>/)?.[0] ?? '';
  assert.ok(panel, 'the content panel rendered');
  assert.ok(!/\brole=/.test(panel), `the inner panel still carries a role, so both are exposed: ${panel}`);
  // A showModal()-opened native dialog is exposed as modal by the platform, so
  // aria-modal on the node that owns the role would be redundant. The e2e
  // asserts the computed `modal` property is still true without it.
  assert.ok(!out.includes('aria-modal'), `served a redundant aria-modal: ${out.slice(0, 400)}`);
});

test('ui-alert-dialog-content: the alertdialog role is on the native <dialog> at SSR', { skip }, async () => {
  const out = await ssr(
    ['alert-dialog.ts'],
    (html) => html`<ui-alert-dialog-content><h2>Are you sure?</h2></ui-alert-dialog-content>`,
  );
  assert.match(
    out,
    /<dialog[^>]*data-slot="alert-dialog-native"[^>]*role="alertdialog"|<dialog[^>]*role="alertdialog"[^>]*data-slot="alert-dialog-native"/,
    `the native <dialog> does not carry the alertdialog role: ${out.slice(0, 400)}`,
  );
  const panel = out.match(/<div[^>]*data-slot="alert-dialog-content"[^>]*>/)?.[0] ?? '';
  assert.ok(panel, 'the content panel rendered');
  assert.ok(!/\brole=/.test(panel), `the inner panel still carries a role, so both are exposed: ${panel}`);
  assert.ok(!out.includes('aria-modal'), `served a redundant aria-modal: ${out.slice(0, 400)}`);
});

// The sonner toast role is deliberately NOT asserted here. `items` is an empty
// instance signal, so a viewport always renders zero toasts server-side and a
// toast's role never reaches the server renderer through markup at all. The
// branch in sonner.ts is still the correct shape (a nullish hole is the
// documented footgun this file exists for), but its observable contract lives
// in the browser suite and in the accessibility-tree e2e.
