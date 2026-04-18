/**
 * Runtime tests for `defineComponent` + `defineProp`. Type-level
 * behaviour (instance-field inference from the properties descriptor) is
 * verified separately in test/types/component-types.test-d.ts — those tests
 * are compile-only and don't run at node:test time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WebComponent,
  defineComponent,
  defineProp,
  html,
  renderToString,
} from '../packages/core/index.js';

test('defineComponent: returns a WebComponent subclass', () => {
  const C = defineComponent({ count: { type: Number } });
  assert.ok(Object.getPrototypeOf(C) === WebComponent,
    'defineComponent result extends WebComponent');
});

test('defineComponent: static properties reflects the descriptor map', () => {
  const props = { count: { type: Number }, label: { type: String } };
  const C = defineComponent(props);
  assert.equal(C.properties.count.type, Number);
  assert.equal(C.properties.label.type, String);
});

test('defineComponent: instance gets reactive accessors for each property', () => {
  class Counter extends defineComponent({
    count: { type: Number },
    label: { type: String },
  }) {
    static tag = 'def-counter';
    render() { return html`<p>${this.label}: ${this.count}</p>`; }
  }
  Counter.register();

  const el = new Counter();
  el.count = 5;
  el.label = 'hits';
  assert.equal(el.count, 5);
  assert.equal(el.label, 'hits');
});

test('defineComponent: SSR renders with declared properties', async () => {
  class Greet extends defineComponent({ name: { type: String } }) {
    static tag = 'def-greet';
    render() { return html`<p>Hello, ${this.name ?? 'world'}</p>`; }
  }
  Greet.register();
  const out = await renderToString(html`<def-greet name="Alice"></def-greet>`);
  assert.match(out, /Hello, Alice/);
});

test('defineComponent: tolerates empty / missing descriptor map', () => {
  const C = defineComponent({});
  assert.deepEqual(C.properties, {});
  const D = /** @type any */ (defineComponent)(null);
  assert.deepEqual(D.properties, {});
});

test('defineProp: identity at runtime', () => {
  const d = { type: Object, reflect: false };
  assert.strictEqual(defineProp(d), d);
});

test('defineProp + defineComponent: converter wires through to the descriptor', () => {
  /** @type {(v: string | null) => { n: number }} */
  const fromAttribute = (v) => ({ n: Number(v || 0) });
  const toAttribute = (/** @type any */ v) => String(v.n);

  const decl = defineProp({
    type: Object,
    converter: { fromAttribute, toAttribute },
  });
  const C = defineComponent({ boxed: decl });

  assert.strictEqual(C.properties.boxed, decl,
    'declaration object passed through unchanged');
  assert.strictEqual(C.properties.boxed.converter.fromAttribute, fromAttribute);
  assert.deepEqual(C.properties.boxed.converter.fromAttribute('42'), { n: 42 });
});
