/**
 * TypeScript overlay for packages/core/src/component.js.
 *
 * The runtime is JSDoc-authored JavaScript; this file exists so editors
 * (tsserver — used by VS Code, Neovim, WebStorm, Zed) resolve imports
 * with full type information. Zero runtime cost: nothing in this file
 * ships to the browser.
 */

import type { CSSResult } from './css.js';
import type { TemplateResult } from './html.js';

/** Any constructor the framework accepts as the `type:` field of a property. */
export type PropertyConstructor<T = unknown> =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | ObjectConstructor
  | ArrayConstructor
  | (new (...args: any[]) => T)
  | ((v: any) => T);

/**
 * Runtime-level property declaration. Matches the shape the framework
 * accepts inside `static properties = { … }`.
 */
export interface PropertyDeclaration<T = unknown> {
  /** Constructor used for string → value coercion when the attribute changes. */
  type?: PropertyConstructor<T>;
  /** Write property changes back to the HTML attribute (kebab-cased). */
  reflect?: boolean;
  /** Internal-only: no attribute, no reflection, but still reactive. */
  state?: boolean;
  /** Rename the attribute, or pass `false` to suppress the attribute entirely. */
  attribute?: string | false;
  /** Custom attribute ⇄ property serialisation. Takes precedence over `type`. */
  converter?: {
    fromAttribute?: (value: string | null, type?: PropertyConstructor<T>) => T;
    toAttribute?: (value: T, type?: PropertyConstructor<T>) => string | null;
  };
  /** Custom dirty check. Return `true` to schedule an update. */
  hasChanged?: (newValue: T, oldValue: T) => boolean;
  /**
   * Phantom marker used by `defineProp<T>()` to carry a caller-supplied
   * value type when the constructor alone doesn't give enough information
   * (e.g. `type: Object` for a rich user-defined class).
   */
  __typed?: T;
}

/** Map a single PropertyDeclaration (or bare constructor) to its instance-level value type. */
export type PropertyValue<D> =
  // 1. Phantom-typed wins — set via `defineProp<T>()`.
  D extends { __typed?: infer U } ? [U] extends [undefined] ? _FromRuntime<D> : Exclude<U, undefined> :
  _FromRuntime<D>;

type _FromRuntime<D> =
  // 2. Custom converter — trust its fromAttribute return type.
  D extends { converter: { fromAttribute: (value: any, type?: any) => infer R } } ? R :
  // 3. Built-in type constructors.
  D extends { type: NumberConstructor } ? number :
  D extends { type: StringConstructor } ? string :
  D extends { type: BooleanConstructor } ? boolean :
  D extends { type: ArrayConstructor } ? unknown[] :
  D extends { type: ObjectConstructor } ? Record<string, unknown> :
  // 4. Class constructor — its instance type.
  D extends { type: new (...args: any[]) => infer I } ? I :
  // 5. Bare constructors (no wrapper object) — legacy shorthand.
  D extends NumberConstructor ? number :
  D extends StringConstructor ? string :
  D extends BooleanConstructor ? boolean :
  D extends ArrayConstructor ? unknown[] :
  D extends ObjectConstructor ? Record<string, unknown> :
  D extends new (...args: any[]) => infer I ? I :
  unknown;

/** Map a full `static properties` descriptor to the instance-fields shape. */
export type PropertyValues<P> = {
  -readonly [K in keyof P]: PropertyValue<P[K]>;
};

/** Reactive controller protocol (Lit-compatible). */
export interface ReactiveController {
  hostConnected?(): void;
  hostDisconnected?(): void;
  hostUpdate?(): void;
  hostUpdated?(): void;
}

/**
 * Base class for interactive web components.
 *
 * Instance fields declared in `static properties` don't appear on the
 * type here — pass them via the `defineComponent()` factory (recommended
 * for full inference) or add them manually with `declare`.
 */
export abstract class WebComponent extends HTMLElement {
  static tag: string;
  static shadow: boolean;
  static hydrate: 'visible' | undefined;
  static properties: Record<string, PropertyDeclaration>;
  static styles: CSSResult | CSSResult[] | null;
  static lazy?: boolean;
  static register(moduleUrl?: string): void;
  static readonly observedAttributes: string[];

  /** Instance-level reactive state. Prefer `setState()` to mutate. */
  state: Record<string, unknown>;
  /** Schedule a re-render with a state patch. Batches multiple calls via microtask. */
  setState(patch: Record<string, unknown>): void;
  /** Schedule a re-render without mutating state. */
  requestUpdate(): void;
  /** Attach a reactive controller. */
  addController(controller: ReactiveController): void;
  /** Detach a reactive controller. */
  removeController(controller: ReactiveController): void;
  /** Returns the template for this render. May be async. */
  render(): TemplateResult | Promise<TemplateResult> | void;
  /** One-shot hook after the first render lands in the DOM. */
  firstUpdated?(): void;

  connectedCallback?(): void;
  disconnectedCallback?(): void;
  attributeChangedCallback?(name: string, oldValue: string | null, newValue: string | null): void;
}

/**
 * Typed component factory — the recommended way to get zero-duplication
 * props typing. Returns a WebComponent subclass with:
 *   • `static properties` pre-set to the passed descriptor map,
 *   • instance fields typed via `PropertyValues<P>`.
 *
 *     class Counter extends defineComponent({
 *       count: { type: Number, reflect: true },
 *       label: { type: String },
 *     }) {
 *       static tag = 'my-counter';
 *       // this.count: number, this.label: string — inferred
 *       render() { return html`${this.label}: ${this.count}`; }
 *     }
 *
 * For a custom class instance type, use `defineProp<T>()` in the descriptor:
 *
 *     class Profile extends defineComponent({
 *       user: defineProp<User>({ type: Object }),
 *     }) { ... }
 */
export function defineComponent<P extends Record<string, PropertyDeclaration>>(
  properties: P
): {
  new (): WebComponent & PropertyValues<P>;
  readonly prototype: WebComponent & PropertyValues<P>;
  tag: string;
  shadow: boolean;
  hydrate: 'visible' | undefined;
  properties: P;
  styles: CSSResult | CSSResult[] | null;
  lazy?: boolean;
  register(moduleUrl?: string): void;
  readonly observedAttributes: string[];
};

/**
 * Explicit type-only helper for a single declaration. Use it when the value
 * type can't be inferred from the constructor alone — e.g. `type: Object`
 * with a specific shape, or a converter returning a complex union.
 *
 *     defineProp<User>({ type: Object, reflect: false })
 */
export function defineProp<T>(d: PropertyDeclaration<T>): PropertyDeclaration<T>;
