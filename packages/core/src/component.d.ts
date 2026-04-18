/**
 * TypeScript overlay for packages/core/src/component.js.
 *
 * The runtime is JSDoc-authored JavaScript; this file exists so editors
 * (tsserver — used by VS Code, Neovim, Zed, WebStorm) resolve imports
 * with full type information. Without this overlay, `declare foo: Foo`
 * would type the field but the surrounding class (`this.setState`,
 * `this.state`, `this.requestUpdate`, lifecycle hooks) would be weakly
 * typed. Zero runtime cost: nothing in this file ships to the browser.
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

/** Runtime-level property declaration — matches `static properties = { … }`. */
export interface PropertyDeclaration<T = unknown> {
  /** Constructor used for string → value coercion when the attribute changes. */
  type?: PropertyConstructor<T>;
  /** Write property changes back to the HTML attribute (kebab-cased). */
  reflect?: boolean;
  /** Internal-only: no attribute, no reflection, but still reactive. */
  state?: boolean;
  /** Rename the attribute, or pass `false` to suppress it entirely. */
  attribute?: string | false;
  /** Custom attribute ⇄ property serialisation. Takes precedence over `type`. */
  converter?: {
    fromAttribute?: (value: string | null, type?: PropertyConstructor<T>) => T;
    toAttribute?: (value: T, type?: PropertyConstructor<T>) => string | null;
  };
  /** Custom dirty check. Return `true` to schedule an update. */
  hasChanged?: (newValue: T, oldValue: T) => boolean;
}

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
 * Declare runtime behaviour via `static properties = { … }` and type
 * each field with a sibling `declare foo: Foo`:
 *
 *     class StudentCard extends WebComponent {
 *       static tag = 'student-card';
 *       static properties = { student: { type: Object } };
 *       declare student: Student;
 *       render() { return html`<p>${this.student.name}</p>`; }
 *     }
 *     StudentCard.register(import.meta.url);
 *
 * The `declare` field has no runtime cost — it tells TypeScript the
 * field's type without emitting a class-field initializer that would
 * clobber the reactive accessor the framework installs via
 * `Object.defineProperty` in the constructor.
 *
 * See the Editor Setup doc for tooling that gives attribute/tag
 * intelligence inside `html\`…\`` templates.
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
  /** Schedule a re-render with a state patch. Batches via microtask. */
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
  /** Optional render-error boundary inside the component. */
  renderError?(error: Error): TemplateResult | void;

  connectedCallback?(): void;
  disconnectedCallback?(): void;
  attributeChangedCallback?(name: string, oldValue: string | null, newValue: string | null): void;
}
