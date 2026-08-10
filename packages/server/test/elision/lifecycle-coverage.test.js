/**
 * GUARD TEST for the elision analyser's single source of truth.
 *
 * webjs development is largely AI-agent driven, so the risk is that a
 * future change adds a new interactivity surface to WebComponent (a new
 * lifecycle hook, a new public method) without teaching the elision
 * analyser about it. That would let the analyser wrongly elide a
 * component that now does client work, and the failure would be silent
 * in production.
 *
 * This test makes that drift LOUD. It introspects the live
 * WebComponent prototype and asserts every public method is classified
 * in this file. Adding a method to WebComponent without classifying it
 * here fails immediately, and the fix is to add the marker to the
 * matching list in component-elision.js (see CLASSIFICATION below).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebComponent } from '../../../core/src/component.js';
import * as directives from '../../../core/src/directives.js';
import * as taskMod from '../../../core/src/task.js';
import * as contextMod from '../../../core/src/context.js';
import * as core from '../../../core/index.js';
import * as routerClient from '../../../core/src/router-client.js';
import {
  analyzeComponentSource,
  CLIENT_LIFECYCLE_HOOKS,
  CLIENT_METHOD_CALLS,
  CLIENT_ROUTER_IMPORTS,
  REACTIVE_IMPORTS,
} from '../../src/component-elision.js';

/**
 * Every PUBLIC (non-underscore) method on WebComponent.prototype, mapped
 * to how the elision analyser must treat it:
 *   'override-hook' : overriding it is client work, must be in CLIENT_LIFECYCLE_HOOKS
 *   'call'          : calling it is client work, must be in CLIENT_METHOD_CALLS
 *   'inert'         : present on every component, never a ship signal (render)
 *
 * When core adds a public method, this map must gain an entry, then the
 * matching list in component-elision.js must too (enforced below).
 */
const CLASSIFICATION = {
  connectedCallback: 'override-hook',
  disconnectedCallback: 'override-hook',
  attributeChangedCallback: 'override-hook',
  shouldUpdate: 'override-hook',
  willUpdate: 'override-hook',
  update: 'override-hook',
  updated: 'override-hook',
  firstUpdated: 'override-hook',
  getUpdateComplete: 'override-hook',
  renderError: 'override-hook',
  renderFallback: 'override-hook',
  requestUpdate: 'call',
  addController: 'call',
  removeController: 'call',
  render: 'inert',
  // Server-only: runs the pre-render lifecycle at SSR. Never a client-ship
  // signal (it executes during SSR regardless of whether the module is
  // elided), so overriding or calling it does not force interactivity.
  performServerUpdate: 'inert',
};

function publicPrototypeMethods() {
  return Object.getOwnPropertyNames(WebComponent.prototype).filter(
    (n) => n !== 'constructor' && !n.startsWith('_') && typeof WebComponent.prototype[n] === 'function',
  );
}

test('every public WebComponent method is classified here', () => {
  const live = publicPrototypeMethods().sort();
  const known = Object.keys(CLASSIFICATION).sort();
  assert.deepEqual(
    live,
    known,
    'WebComponent prototype changed. Classify the new/removed method in CLASSIFICATION, ' +
      'then add its marker to CLIENT_LIFECYCLE_HOOKS or CLIENT_METHOD_CALLS in component-elision.js.',
  );
});

test('every override-hook is in CLIENT_LIFECYCLE_HOOKS', () => {
  for (const [name, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== 'override-hook') continue;
    assert.ok(
      CLIENT_LIFECYCLE_HOOKS.includes(name),
      `${name} is an override hook but missing from CLIENT_LIFECYCLE_HOOKS`,
    );
  }
});

test('every call signal is in CLIENT_METHOD_CALLS', () => {
  for (const [name, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== 'call') continue;
    assert.ok(
      CLIENT_METHOD_CALLS.includes(name),
      `${name} is a call signal but missing from CLIENT_METHOD_CALLS`,
    );
  }
});

test('overriding each override-hook makes the analyser ship the component', () => {
  for (const [name, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== 'override-hook') continue;
    const src = `
      import { WebComponent, html } from '@webjsdev/core';
      class Probe extends WebComponent {
        ${name}() { /* client work */ }
        render() { return html\`<p>x</p>\`; }
      }
      Probe.register('probe-el');
    `;
    assert.equal(
      analyzeComponentSource(src).interactive,
      true,
      `overriding ${name} should force interactive`,
    );
  }
});

test('calling each call signal makes the analyser ship the component', () => {
  for (const [name, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== 'call') continue;
    const src = `
      import { WebComponent, html } from '@webjsdev/core';
      class Probe extends WebComponent {
        render() { this.${name}(); return html\`<p>x</p>\`; }
      }
      Probe.register('probe-el');
    `;
    assert.equal(
      analyzeComponentSource(src).interactive,
      true,
      `calling ${name} should force interactive`,
    );
  }
});

test('the inert method (render) alone does not force shipping', () => {
  const src = `
    import { WebComponent, html } from '@webjsdev/core';
    class Pure extends WebComponent {
      render() { return html\`<p>pure</p>\`; }
    }
    Pure.register('pure-el');
  `;
  assert.equal(analyzeComponentSource(src).interactive, false);
});

// ── Imports half of the single source of truth ──────────────────────
//
// The lifecycle/method guards above cover signals that live on the
// WebComponent prototype. Reactive primitives instead arrive as IMPORTS
// from @webjsdev/core surfaces. The directives surface is where a new
// client-only directive would most plausibly be added, so classify every
// directive and fail when an unclassified one appears.

/** Directives whose only effect runs on the client (must be in REACTIVE_IMPORTS). */
const CLIENT_DIRECTIVES = ['asyncAppend', 'asyncReplace', 'createRef', 'live', 'ref', 'until', 'watch'];
/** Directives that render at SSR time and are safe in display-only components. */
const RENDER_TIME_DIRECTIVES = ['cache', 'guard', 'keyed', 'repeat', 'templateContent', 'unsafeHTML'];

test('every @webjsdev/core/directives export is classified (forces SSOT update on a new directive)', () => {
  // `is*` exports are internal type-guards, not directives an author applies.
  const live = Object.keys(directives).filter((n) => !/^is[A-Z]/.test(n)).sort();
  const classified = [...CLIENT_DIRECTIVES, ...RENDER_TIME_DIRECTIVES].sort();
  assert.deepEqual(
    live,
    classified,
    'A directive was added or removed. Classify it: client-only -> add to REACTIVE_IMPORTS ' +
      'in component-elision.js AND to CLIENT_DIRECTIVES here; render-time -> add to RENDER_TIME_DIRECTIVES.',
  );
});

test('every client directive is present in REACTIVE_IMPORTS', () => {
  for (const name of CLIENT_DIRECTIVES) {
    assert.ok(REACTIVE_IMPORTS.has(name), `${name} is client-only but missing from REACTIVE_IMPORTS`);
  }
});

test('no REACTIVE_IMPORTS entry is stale (each is a real @webjsdev/core export)', () => {
  const exported = new Set([
    ...Object.keys(core),
    ...Object.keys(directives),
    ...Object.keys(taskMod),
    ...Object.keys(contextMod),
  ]);
  for (const name of REACTIVE_IMPORTS) {
    assert.ok(exported.has(name), `${name} is in REACTIVE_IMPORTS but no longer exported by core (rename/removal?)`);
  }
});

/**
 * The router half of the same staleness contract (#1291). `CLIENT_ROUTER_IMPORTS`
 * is how a NAMED import off the bare `@webjsdev/core` entry is recognized as
 * client work (the `@webjsdev/core/client-router` subpath is caught earlier, by
 * specifier). An omission here does not fail loudly: the component is simply not
 * seen as interactive and gets ELIDED, so its router call never runs in the
 * browser. `loadFrame` was missing from this list.
 */
const barrelRouterApis = Object.keys(routerClient)
  .filter((n) => !n.startsWith('_') && n !== 'default' && typeof routerClient[n] === 'function')
  .filter((n) => n in core);

test('the barrel re-exports a non-empty router surface (anti-vacuum)', () => {
  assert.ok(
    barrelRouterApis.length >= 5,
    `expected >= 5 router APIs reachable from the @webjsdev/core barrel, got ${barrelRouterApis.length}`,
  );
});

test('every router API reachable from the bare core entry is in CLIENT_ROUTER_IMPORTS', () => {
  const missing = barrelRouterApis.filter((n) => !CLIENT_ROUTER_IMPORTS.includes(n));
  assert.deepEqual(
    missing,
    [],
    `these router functions are importable from '@webjsdev/core' but absent from CLIENT_ROUTER_IMPORTS, ` +
      `so a component importing one is not seen as interactive and is wrongly elided: ${missing.join(', ')}`,
  );
});

test('no CLIENT_ROUTER_IMPORTS entry is stale (each is a real @webjsdev/core export)', () => {
  for (const name of CLIENT_ROUTER_IMPORTS) {
    assert.ok(name in core, `${name} is in CLIENT_ROUTER_IMPORTS but no longer exported by core (rename/removal?)`);
  }
});
