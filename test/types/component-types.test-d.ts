/**
 * Compile-time type tests for webjs WebComponent intelligence.
 *
 * This file is NOT executed by `node:test`. It is consumed by tsserver in
 * your editor and by any TypeScript project that adds this workspace to
 * its `paths`. If the WebComponent typing regresses, the errors surface
 * as red squiggles here.
 *
 * To verify manually:
 *   npx -p typescript@5.6 tsc --noEmit --target esnext --moduleResolution bundler \
 *     test/types/component-types.test-d.ts
 */

import {
  WebComponent,
  html,
  type PropertyDeclaration,
  type ReactiveController,
} from 'webjs';

/* ------------- Helper: compile-time assertion ------------- */

type Assert<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

/* ------------- `declare`-typed fields work alongside static properties ------------- */

class Student {
  id = '';
  name = '';
}

class StudentCard extends WebComponent {
  static properties = { student: { type: Object } };
  declare student: Student;
  render() {
    // this.student is a real Student — method access, property access, all typed.
    const _s: string = this.student.name;
    return html`<p>${this.student.name}</p>`;
  }
}
customElements.define('student-card', StudentCard);

const card = new StudentCard();
type _Student = Assert<Equal<typeof card.student, Student>>;

/* ------------- Framework APIs are typed on `this` ------------- */

class Counter extends WebComponent {
  static properties = { count: { type: Number } };
  declare count: number;

  bump() {
    // All of these are typed via the .d.ts overlay.
    this.setState({ foo: 'bar' });
    this.requestUpdate();
    const _s: Record<string, unknown> = this.state;
    return html`<p>${this.count}</p>`;
  }
}
customElements.define('my-counter', Counter);

/* ------------- PropertyDeclaration shape accepts the expected fields ------------- */

const decl: PropertyDeclaration = {
  type: Number,
  reflect: true,
  state: false,
  attribute: 'data-count',
  hasChanged: (a, b) => a !== b,
  converter: {
    fromAttribute: (v) => Number(v),
    toAttribute: (v) => String(v),
  },
};
void decl; // silence "unused" for the fixture

/* ------------- ReactiveController shape ------------- */

const ctrl: ReactiveController = {
  hostConnected() {},
  hostDisconnected() {},
  hostUpdate() {},
  hostUpdated() {},
};
void ctrl;

/* ------------- Optional: HTMLElementTagNameMap augmentation ------------- */
// Standard TypeScript pattern (same one Lit uses). Enables typed
// document.querySelector / createElement. Opt-in per component.

declare global {
  interface HTMLElementTagNameMap {
    'student-card': StudentCard;
  }
}

const el = document.querySelector('student-card');
type _ElType = Assert<Equal<typeof el, StudentCard | null>>;

export {};
