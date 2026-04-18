/**
 * Compile-time type tests for `defineComponent` + `defineProp`.
 *
 * This file is NOT executed by `node:test`. It is consumed by tsserver in
 * your editor and by any TypeScript project that adds this workspace to its
 * `paths`. If any of the inference rules regress, the errors surface as
 * red squiggles here.
 *
 * To verify manually:
 *   npx -p typescript@5.6 tsc --noEmit --target esnext --moduleResolution bundler \
 *     test/types/component-types.test-d.ts
 */

import {
  WebComponent,
  defineComponent,
  defineProp,
  html,
  type PropertyValue,
  type PropertyValues,
  type PropertyDeclaration,
} from 'webjs';

/* ------------- Helper: compile-time assertion ------------- */

type Assert<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

/* ------------- PropertyValue<D>: constructor-based inference ------------- */

type T1 = Assert<Equal<PropertyValue<{ type: NumberConstructor }>, number>>;
type T2 = Assert<Equal<PropertyValue<{ type: StringConstructor }>, string>>;
type T3 = Assert<Equal<PropertyValue<{ type: BooleanConstructor }>, boolean>>;
type T4 = Assert<Equal<PropertyValue<{ type: ArrayConstructor }>, unknown[]>>;
type T5 = Assert<Equal<PropertyValue<{ type: ObjectConstructor }>, Record<string, unknown>>>;

/* ------------- PropertyValue<D>: class-constructor inference ------------- */

class User { id = ''; name = ''; }
type T6 = Assert<Equal<PropertyValue<{ type: typeof User }>, User>>;

/* ------------- PropertyValue<D>: converter-based inference ------------- */

type T7 = Assert<Equal<
  PropertyValue<{ type: ObjectConstructor; converter: { fromAttribute: (v: string | null) => Date } }>,
  Date
>>;

/* ------------- PropertyValues<P>: whole-map inference ------------- */

const sample = defineProp<number>({ type: Number });
type T8 = Assert<Equal<PropertyValue<typeof sample>, number>>;

type Props = {
  count: { type: NumberConstructor };
  label: { type: StringConstructor };
  active: { type: BooleanConstructor };
};
type T9 = Assert<Equal<
  PropertyValues<Props>,
  { count: number; label: string; active: boolean }
>>;

/* ------------- defineComponent: full inference end-to-end ------------- */

class Counter extends defineComponent({
  count: { type: Number, reflect: true },
  label: { type: String },
  active: { type: Boolean },
}) {
  static tag = 'my-counter';
  render() {
    // These should typecheck WITHOUT a single `declare` line.
    const _n: number = this.count;
    const _s: string = this.label;
    const _b: boolean = this.active;
    return html`<p>${this.label}: ${this.count} ${this.active ? 'on' : 'off'}</p>`;
  }
}

// Instance-level assignment respects the inferred types.
const c = new Counter();
const _cn: number = c.count;
const _cs: string = c.label;
const _cb: boolean = c.active;

/* ------------- defineProp<T>: phantom-typed class shape ------------- */

class Profile extends defineComponent({
  user: defineProp<User>({ type: Object }),
}) {
  static tag = 'user-profile';
  render() {
    const _u: User = this.user;
    return html`<span>${this.user.name}</span>`;
  }
}

/* ------------- Backwards-compat: bare WebComponent + declare still works ------------- */

class Legacy extends WebComponent {
  static tag = 'my-legacy';
  static properties = { count: { type: Number } };
  declare count: number;
  render() {
    const _n: number = this.count;
    return html`<p>${this.count}</p>`;
  }
}

/* ------------- Negative: wrong descriptor rejected at class body ------------- */
// Uncomment to verify: `count` should be a number, not a string.
//
// class Bad extends defineComponent({ count: { type: Number } }) {
//   static tag = 'bad-counter';
//   render() {
//     const _s: string = this.count;  // ← expected error: Type 'number' is not assignable to type 'string'.
//     return html`${this.count}`;
//   }
// }

export {};
