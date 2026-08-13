/**
 * Component-authoring rules: registration, reactive-property declaration, and
 * the SSR-safety of a component body.
 *
 * Lifted verbatim out of checkConventions, which held all twenty rules inline
 * in one 900-line function. Each rule keeps its original comment header, its
 * logic, and its position in the run order.
 */
import {
  extractWebComponentClassBodies, matchClosingBrace, parsePropEntries,
} from '../js-scan.js';
import {
  isComponentFile, arrayPropUsesObject, findFieldInitializers, methodBodyOf,
  findBrowserMemberUses,
} from './helpers.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */


/**
 * Rule: `components-have-register`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkComponentsHaveRegister(files, violations) {
  // --- Rule: components-have-register ---
  {
    for (const { rel, scan } of files) {
      if (!isComponentFile(rel)) continue;
      // Use redacted source so a code-example string like
      // `Foo.register('bar')` inside a tagged template literal does
      // not falsely satisfy the rule for a sibling unregistered
      // class. Real register() calls live at top level where the
      // redactor leaves them alone.
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      // Accept either registration pattern:
      //   Counter.register('tag')                    (WebJs idiom)
      //   customElements.define('tag', Counter)      (native)
      if (/\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*['"`]/.test(scan)) continue;
      if (/\bcustomElements\.define\s*\(/.test(scan)) continue;
      violations.push({
        rule: 'components-have-register',
        file: rel,
        message: "Component extends WebComponent but is never registered. Call ClassName.register('tag-name') at the bottom of the file.",
        fix: "Add `ClassName.register('tag-name')` after the class definition",
      });
    }
  }
}

/**
 * Rule: `no-static-properties`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoStaticProperties(files, violations) {
  // --- Rule: no-static-properties ---
  // A hand-written `static properties = { … }` in a WebComponent class body is
  // no longer supported: reactive properties are declared via the
  // `extends WebComponent({ … })` factory (the runtime throws on a direct
  // `static properties`). Flag it statically so the editor catches it before
  // the page 500s.
  {
    for (const { rel, scan } of files) {
      // Use redacted source so fixture-style strings like
      // `class X extends WebComponent { static properties = {…} }` inside
      // template literals don't trip the rule. Real declarations live at
      // top-level code where the redactor leaves them alone.
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        if (!/static\s+properties\s*=\s*\{/.test(body)) continue;
        violations.push({
          rule: 'no-static-properties',
          file: rel,
          message:
            '`static properties = { … }` is no longer supported; declare reactive properties via the `extends WebComponent({ … })` factory instead.',
          fix: 'Move the properties into the factory call: `class X extends WebComponent({ count: Number })`. Use `prop(Number, { reflect: true })` for options and set defaults in the constructor after super(). Delete the `static properties` block and any `declare` fields for those props.',
        });
      }
    }
  }
}

/**
 * Rule: `reactive-props-no-class-field`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkReactivePropsNoClassField(files, violations) {
  // --- Rule: reactive-props-no-class-field ---
  // A reactive property declared via the factory must not also carry a plain
  // class-field declaration (initializer OR type-only): under modern class-field
  // semantics (including `erasableSyntaxOnly: true`) every class-field declaration
  // compiles to Object.defineProperty after super() and clobbers the framework's
  // reactive accessor (silent broken re-renders). Catches `count = 0`,
  // `count: number = 0`, `count!: number`, and `count?: number`.
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body, factoryProps } of extractWebComponentClassBodies(scan)) {
        if (factoryProps.size === 0) continue;
        for (const bad of findFieldInitializers(body, factoryProps)) {
          violations.push({
            rule: 'reactive-props-no-class-field',
            file: rel,
            message: `Reactive prop \`${bad}\` uses a class-field declaration (initializer or type-only); this clobbers the framework's reactive accessor under modern class-field semantics.`,
            fix: `Delete the class-field declaration and set the default by assigning \`this.${bad} = <value>\` inside \`constructor()\` after \`super()\`.`,
          });
        }
      }
    }
  }
}

/**
 * Rule: `array-prop-uses-array-type`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkArrayPropUsesArrayType(files, violations) {
  // --- Rule: array-prop-uses-array-type ---
  // An array-typed reactive prop declared via the factory should pass the
  // `Array` runtime constructor, not `Object`. Both share one converter
  // (JSON encode/decode), so `Object` does not crash, but it misstates the
  // prop contract and diverges from the documented built-in set. Fires only
  // when the factory generic is itself an array type AND the constructor is
  // `Object`; a bare `foo: Object` (no generic to prove array-ness) is left
  // alone to avoid false positives. Uses the redacted `scan`, so a
  // `prop<X[]>(Object)` shown inside an html`` example string never fires.
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { factoryArg } of extractWebComponentClassBodies(scan)) {
        const objStart = factoryArg.indexOf('{');
        if (objStart === -1) continue;
        const objEnd = matchClosingBrace(factoryArg, objStart + 1);
        if (objEnd === -1) continue;
        const objContent = factoryArg.slice(objStart + 1, objEnd);
        for (const { key, value } of parsePropEntries(objContent)) {
          if (!arrayPropUsesObject(value)) continue;
          violations.push({
            rule: 'array-prop-uses-array-type',
            file: rel,
            message: `Array-typed reactive prop \`${key}\` is declared with the \`Object\` constructor (\`prop<…[]>(Object)\`); use \`Array\` so the runtime converter matches the declared shape.`,
            fix: `Change the constructor to \`Array\`: \`${key}: prop<…[]>(Array)\`. Object and Array share one converter so behaviour is unchanged, but \`Array\` states the prop's shape correctly.`,
          });
        }
      }
    }
  }
}

/**
 * Rule: `no-browser-globals-in-render`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoBrowserGlobalsInRender(files, violations) {
  // --- Rule: no-browser-globals-in-render ---
  // The SSR pipeline runs the constructor (`new Cls()`), willUpdate, and
  // render() on the server element shim (attribute methods backed, but no real
  // DOM). A genuinely browser-only global or an unshimmed HTMLElement member on
  // `this` touched in any of those throws at SSR time. Those belong in
  // connectedCallback / post-render hooks, which SSR never calls. willUpdate is
  // scanned because it now runs at SSR (issue #217).
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        for (const method of ['constructor', 'willUpdate', 'render']) {
          const code = methodBodyOf(body, method);
          if (!code) continue;
          for (const { member, kind } of findBrowserMemberUses(code)) {
            violations.push({
              rule: 'no-browser-globals-in-render',
              file: rel,
              message: `\`${member}\` (${kind}) is used in ${method}(), which runs during SSR where it is not available, so it throws and the component fails to server-render.`,
              fix: `Move browser-only work to connectedCallback() or a lifecycle hook (firstUpdated/updated), which SSR never calls. Seed first-paint defaults in the constructor only from server-known inputs (attributes / props), then refine in connectedCallback by writing to a signal.`,
            });
          }
        }
      }
    }
  }
}

/**
 * Rule: `no-shadowed-native-member`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoShadowedNativeMember(files, violations) {
  // --- Rule: no-shadowed-native-member ---
  // A WebComponent method named after a native DOM mutation method WebJs
  // instruments on every light-DOM host for the slot API (#1021) is SHADOWED at
  // runtime (the native/instrumented method wins), so the component method never
  // runs, while TypeScript stays green (a shorter override is assignable). Rename
  // the handler. The lifecycle hooks are meant to be overridden, so only the DOM
  // mutation members are reserved.
  {
    const NATIVE_MEMBERS = [
      'append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'remove',
      'appendChild', 'insertBefore', 'removeChild', 'replaceChild',
    ];
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        // The slot interception installs only on LIGHT-DOM hosts (the shadow
        // branch keeps the true native methods), so a shadow component's method
        // is never shadowed. Skip the whole class.
        if (/static\s+shadow\s*=\s*true/.test(body)) continue;
        // Brace-depth map over the (already string/comment-masked) class body,
        // so only TOP-LEVEL class members flag: a same-named object-literal
        // shorthand or function expression nested inside a method body is a
        // different object's property and shadows nothing.
        const depth = new Int32Array(body.length);
        {
          let d = 0;
          for (let i = 0; i < body.length; i++) {
            if (body[i] === '{') { depth[i] = d; d++; }
            else if (body[i] === '}') { d--; depth[i] = d; }
            else depth[i] = d;
          }
        }
        for (const name of NATIVE_MEMBERS) {
          // Two shadowed-definition shapes, both instance-level: the method /
          // accessor form (`remove() {`, `get remove() {`), and the class-field
          // FUNCTION form (`remove = () => {}` / `= function () {}`), which the
          // connect-time interception install overwrites just the same. A
          // `static` member lives on the constructor and shadows nothing.
          const methodRe = new RegExp(
            `(?:^|[\\s;}])((?:static\\s+)?)(?:async\\s+)?(?:get\\s+|set\\s+)?(${name})\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`,
            'g',
          );
          const fieldRe = new RegExp(
            `(?:^|[\\s;}])((?:static\\s+)?)(${name})\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]*)?=>|[\\w$]+\\s*=>)`,
            'g',
          );
          let flagged = false;
          for (const re of [methodRe, fieldRe]) {
            let m;
            while (!flagged && (m = re.exec(body)) !== null) {
              if (m[1]) continue;                       // static: not shadowed
              const nameIdx = m.index + m[0].indexOf(m[2]);
              if (depth[nameIdx] !== 0) continue;       // nested: another object's property
              flagged = true;
              violations.push({
                rule: 'no-shadowed-native-member',
                file: rel,
                message: `Component member \`${name}\` shadows the native DOM method WebJs instruments for the slot API, so it silently never runs (the native method wins) and TypeScript does not catch it.`,
                fix: `Rename the member to a non-native name (e.g. \`${name}Row()\` / \`${name}Item()\`) and update its call sites.`,
              });
            }
            if (flagged) break;
          }
        }
      }
    }
  }
}
