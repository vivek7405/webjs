/**
 * Validates registry contents against expected invariants.
 *
 * Reads source files directly from `packages/registry/` (no build step
 * anymore, the website composes JSON on demand via _lib/registry.server.ts).
 *
 * v1 architecture is two-tier:
 *   - Tier 1, pure class-helper functions (button, card, badge, alert, …),
 *     they import `cn` from `lib/utils.ts` and export named functions.
 *   - Tier 2, stateful custom elements (dialog, tabs, popover, …), they
 *     import `Base` + `defineElement` and call `defineElement('ui-…', Class)`.
 *
 * Tests cover both shapes plus hallmark-class assertions to catch regressions
 * that would silently nuke the expected visual output (variant classes,
 * size classes, data-state attribute wiring).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'registry');
const COMPONENTS_DIR = join(REGISTRY_DIR, 'components');
const MANIFEST_PATH = join(REGISTRY_DIR, 'registry.json');

const skip = !existsSync(MANIFEST_PATH);

// All v1 components, every one of these MUST exist in the registry and follow
// either the Tier-1 (class-helper) or Tier-2 (custom-element) shape.
const V1_COMPONENTS = [
  'button', 'badge', 'alert', 'card',
  'input', 'textarea', 'label',
  'checkbox', 'switch', 'radio-group', 'native-select',
  'avatar', 'separator', 'skeleton', 'aspect-ratio', 'kbd',
  'table', 'toggle', 'breadcrumb', 'pagination',
  'progress', 'toggle-group',
  'dialog', 'alert-dialog', 'popover', 'tooltip', 'hover-card',
  'tabs', 'accordion', 'collapsible',
  'dropdown-menu', 'sonner',
];

// Components that are Tier 2, must register a custom element.
// popover, accordion, collapsible moved to Tier 1 once their sources
// became pure class helpers on native HTML (Popover API,
// <details>/<summary>). They no longer extend Base or call defineElement.
const TIER_2 = new Set([
  'toggle', 'toggle-group',
  'dialog', 'alert-dialog', 'tooltip', 'hover-card',
  'tabs',
  'dropdown-menu', 'sonner',
]);

function readSource(name) {
  return readFileSync(join(COMPONENTS_DIR, `${name}.ts`), 'utf8');
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

test('registry.json exists and enumerates ≥32 v1 components', { skip }, () => {
  const m = readManifest();
  const uiItems = m.items.filter((it) => it.type === 'registry:ui');
  assert.ok(uiItems.length >= 32, `expected ≥32 registry:ui items, found ${uiItems.length}`);
});

test('every v1 component source file exists and is non-trivial', { skip }, () => {
  for (const name of V1_COMPONENTS) {
    const src = readSource(name);
    assert.ok(src.length > 200, `${name}: source too short`);
  }
});

// #983: every component's module JSDoc must carry a complete, machine-
// extractable @example (the structural snippet served by `webjsui view` / the
// MCP `ui` tool, and stripped from the copied file). This test fires when one
// is missing, empty, or still elided.
test('every v1 component has a complete, extractable @example', { skip }, async () => {
  const { extractExample, hasExample } = await import('../src/registry/example.js');
  const ELLIPSIS = String.fromCharCode(0x2026);
  for (const name of V1_COMPONENTS) {
    const src = readSource(name);
    assert.ok(hasExample(src), `${name}: module JSDoc has no @example block`);
    const ex = extractExample(src);
    assert.ok(ex && ex.length > 20, `${name}: @example extracts empty/too short`);
    assert.ok(!ex.includes(ELLIPSIS) && !ex.includes('...'), `${name}: @example still has an elision`);
    // The example should reference the component (a tag or a helper call), so
    // it is a real usage snippet, not placeholder prose.
    assert.ok(/[<$]/.test(ex), `${name}: @example has no markup / helper call`);
  }
});

// #983: guard the assumptions the hand-rolled JSDoc micro-parser (example.js,
// extract.js) relies on. These hold for every current component; this test
// turns a future violation (which would silently MIS-strip / mis-extract) into
// a clear CI failure at authoring time rather than a latent trap.
test('every component @example is safe for the JSDoc micro-parser', { skip }, () => {
  for (const name of V1_COMPONENTS) {
    const src = readSource(name);
    // The module JSDoc must be a single block: a `*/` inside the @example would
    // make firstBlockComment() terminate the block early.
    const start = src.indexOf('/**');
    const firstEnd = src.indexOf('*/', start + 3);
    const exAt = src.indexOf('@example', start);
    assert.ok(exAt !== -1 && exAt < firstEnd, `${name}: @example must sit inside the first JSDoc block (no */ before it)`);
    // No example line may begin (after the ` * ` gutter) with a JSDoc-tag-shaped
    // token (`@word`): the extractor/stripper treat such a line as the next tag
    // and would truncate the example. The ```html fence line is fine.
    const block = src.slice(start, firstEnd);
    const exampleLines = block.slice(block.indexOf('@example') + '@example'.length).split('\n').slice(1);
    for (const line of exampleLines) {
      const body = line.replace(/^\s*\*\s?/, '');
      assert.ok(!/^@\w+/.test(body), `${name}: an @example line starts with a tag-shaped token ("${body.slice(0, 20)}"), which the parser would treat as the next JSDoc tag`);
    }
  }
});

test('every v1 component is declared in registry.json', { skip }, () => {
  const m = readManifest();
  const names = new Set(m.items.map((it) => it.name));
  for (const name of V1_COMPONENTS) {
    assert.ok(names.has(name), `${name}: missing from registry.json`);
  }
});

test('every Tier-2 component imports WebComponent + html from @webjsdev/core', { skip }, () => {
  for (const name of TIER_2) {
    const src = readSource(name);
    // Refactor: components moved from the local Base + defineElement
    // helpers (in lib/utils.ts) to the Lit-shaped WebComponent base
    // from @webjsdev/core (with html`…` templates and declarative
    // bindings like @click, ?attr, .prop).
    assert.match(
      src,
      /from\s+['"]@webjsdev\/core['"]/,
      `${name}: missing import from '@webjsdev/core'`,
    );
    assert.match(src, /\bWebComponent\b/, `${name}: not extending WebComponent`);
    assert.match(src, /\bhtml`/, `${name}: not using the html\`\` template tag`);
  }
});

test('Tier-2 components register at least one ui-* element via WebComponent.register', { skip }, () => {
  for (const name of TIER_2) {
    const src = readSource(name);
    assert.match(
      src,
      /\.register\(['"]ui-[a-z-]+['"]\)/,
      `${name}: no .register('ui-…') call found`,
    );
  }
});

test('Tier-1 components export named class-helper functions ending in *Class', { skip }, () => {
  const tier1 = V1_COMPONENTS.filter((n) => !TIER_2.has(n));
  for (const name of tier1) {
    const src = readSource(name);
    assert.match(
      src,
      /export\s+(?:const|function)\s+\w+Class\b/,
      `${name}: no exported *Class helper function/const`,
    );
  }
});

test('button : variant + size class strings are present', { skip }, () => {
  const src = readSource('button');
  assert.match(src, /bg-primary/);
  assert.match(src, /bg-destructive/);
  assert.match(src, /bg-secondary/);
  assert.match(src, /hover:bg-primary\/90/);
  assert.match(src, /hover:underline/);    // link variant
  assert.match(src, /hover:bg-accent/);    // ghost / outline
  assert.match(src, /h-9 px-4/);   // default
  assert.match(src, /h-8/);        // sm
  assert.match(src, /h-10/);       // lg
  assert.match(src, /size-9/);     // icon
  assert.match(src, /size-6/);     // icon-xs
});

test('card : exposes all 7 subpart class helpers (no custom elements)', { skip }, () => {
  const src = readSource('card');
  for (const fn of ['cardClass', 'cardHeaderClass', 'cardTitleClass', 'cardDescriptionClass', 'cardActionClass', 'cardContentClass', 'cardFooterClass']) {
    assert.match(src, new RegExp(`export\\s+const\\s+${fn}\\b`), `card missing ${fn}`);
  }
});

test('dialog : delegates to native <dialog> for modal behavior', { skip }, () => {
  const src = readSource('dialog');
  assert.match(src, /'role',\s*'dialog'|"role",\s*"dialog"|role="dialog"/);
  // No aria-modal assertion: the role moved onto the native <dialog> (#1245),
  // and a showModal()-opened native dialog is already exposed as modal by the
  // platform, so the attribute would be redundant on the node that owns the
  // role. That the dialog is EXPOSED as modal is asserted where it can
  // actually be observed, against the computed accessibility tree, in
  // test/e2e/a11y-tree.e2e.mjs. A source regex could never have proven it.
  // Native dialog is what owns Escape, Tab cycling, and focus restoration.
  assert.match(src, /showModal/);
  assert.match(src, /HTMLDialogElement/);
  // Refactor: registration is via WebComponent.register('ui-dialog')
  // instead of the older defineElement('ui-dialog', ...) helper.
  assert.match(src, /\.register\(['"]ui-dialog['"]\)/);
});

test('alert-dialog : uses alertdialog role, blocks Escape via cancel event', { skip }, () => {
  const src = readSource('alert-dialog');
  assert.match(src, /alertdialog/);
  // Native Escape close is cancelled via the dialog's `cancel` event.
  assert.match(src, /@cancel|cancel.*preventDefault|onNativeCancel/);
  assert.match(src, /showModal/);
});

test('popover : tier-1 class helpers + positionFloating utility export', { skip }, () => {
  const src = readSource('popover');
  // No custom element: pure class helpers + a positioning utility for
  // sibling tier-2 components.
  assert.doesNotMatch(src, /defineElement\(/);
  assert.match(src, /export\s+function\s+positionFloating/);
  // Parameterized helper with shadcn parity for side / align / sideOffset / alignOffset.
  assert.match(src, /export\s+function\s+popoverContentClass\s*\(/);
  assert.match(src, /PopoverContentOptions/);
  assert.match(src, /side\??:\s*PopoverSide/);
  assert.match(src, /align\??:\s*PopoverAlign/);
  assert.match(src, /sideOffset/);
  assert.match(src, /alignOffset/);
  // position-area pre-baked classes (Tailwind 4 scanner needs literals).
  assert.match(src, /\[position-area:bottom_span-right\]/);
  assert.match(src, /\[position-area:top_span-left\]/);
  // alignOffset translate classes baked as literals.
  assert.match(src, /translate-x-\[4px\]/);
  assert.match(src, /translate-x-\[-4px\]/);
  assert.match(src, /translate-y-\[4px\]/);
  assert.match(src, /translate-y-\[-4px\]/);
  // popover invoker pattern referenced in the JSDoc.
  assert.match(src, /popovertarget|popover\s+attribute|Popover API/i);
});

test('positionFloating : accepts alignOffset for tier-2 placement', { skip }, () => {
  const src = readSource('popover');
  // The utility consumed by tooltip / hover-card / dropdown-menu must
  // accept alignOffset alongside sideOffset.
  assert.match(src, /alignOffset\??:\s*number/);
});

test('accordion / collapsible : disabled option on trigger class helper', { skip }, () => {
  for (const name of ['accordion', 'collapsible']) {
    const src = readSource(name);
    assert.match(src, /disabled\??:\s*boolean/, `${name}: trigger class missing { disabled } option`);
    assert.match(src, /pointer-events-none/, `${name}: disabled state should include pointer-events-none`);
    assert.match(src, /inert/, `${name}: docs should mention the native inert attribute for full disable`);
  }
});

test('tier-2 components : read align-offset attribute', { skip }, () => {
  for (const name of ['tooltip', 'hover-card', 'dropdown-menu']) {
    const src = readSource(name);
    assert.match(src, /align-offset/, `${name}: should read align-offset attribute`);
    assert.match(src, /alignOffset/, `${name}: should pass alignOffset to positionFloating`);
  }
});

test('tooltip : skip-delay-duration attribute', { skip }, () => {
  const src = readSource('tooltip');
  assert.match(src, /skip-delay-duration/);
  assert.match(src, /lastTooltipHideAt|lastHideAt|skipDelay/i);
});

test('dropdown-menu : typeahead via text-value', { skip }, () => {
  const src = readSource('dropdown-menu');
  assert.match(src, /typeahead/i);
  assert.match(src, /text-value/);
});

test('accordion : tier-1 class helpers on native <details>/<summary>', { skip }, () => {
  const src = readSource('accordion');
  assert.doesNotMatch(src, /defineElement\(/);
  assert.match(src, /<details/);
  assert.match(src, /<summary/);
  // `name="..."` is the exclusive-accordion primitive.
  assert.match(src, /name=/);
  // `type="single"` and `type="multiple"` still documented (parity with shadcn).
  assert.match(src, /'single'|"single"|type="single"/);
  assert.match(src, /'multiple'|"multiple"|type="multiple"/);
  assert.match(src, /collapsible/);
});

test('collapsible : tier-1 class helpers on native <details>/<summary>', { skip }, () => {
  const src = readSource('collapsible');
  assert.doesNotMatch(src, /defineElement\(/);
  assert.match(src, /<details/);
  assert.match(src, /<summary/);
});

test('dropdown-menu / tooltip / hover-card : top-layer via popover attribute', { skip }, () => {
  for (const name of ['dropdown-menu', 'tooltip', 'hover-card']) {
    const src = readSource(name);
    assert.match(src, /popover/i, `${name}: should reference the Popover API`);
    assert.match(src, /showPopover|hidePopover/, `${name}: should call showPopover/hidePopover`);
  }
});

test('tabs : exposes Arrow-key navigation + roles', { skip }, () => {
  const src = readSource('tabs');
  assert.match(src, /ArrowLeft|ArrowRight|ArrowDown|ArrowUp/);
  assert.match(src, /tablist/);
  // Refactor: role is bound declaratively in the html`...` template
  // (role="tab") rather than via setAttribute('role', 'tab').
  assert.match(src, /role=["']tab["']/);
});

test('accordion : supports single/multiple + collapsible', { skip }, () => {
  const src = readSource('accordion');
  assert.match(src, /'single'|"single"/);
  assert.match(src, /'multiple'|"multiple"/);
  assert.match(src, /collapsible/);
});

// #1080: checkbox / radio draw their checked indicator from an injected
// stylesheet that keys on a `data-slot` attribute, and neither class helper
// carries a fallback fill for the checked state (radioClass has no
// checked:bg-* at all). So an @example that omits the attribute teaches a
// copy-paste whose checked state is conveyed by colour alone, the WCAG 1.4.1
// trap both examples used to ship. Assert the pairing at the source, since the
// examples are what `webjsui view` and the MCP `ui` tool hand to an agent.
test('checkbox / radio examples pair the class helper with its data-slot', { skip }, async () => {
  const { extractExample } = await import('../src/registry/example.js');
  for (const [name, type, slot] of [
    ['checkbox', 'checkbox', 'checkbox'],
    ['radio-group', 'radio', 'radio'],
  ]) {
    const ex = extractExample(readSource(name));
    const inputs = ex.match(new RegExp(`<input[^>]*type="${type}"[^>]*>`, 'g')) ?? [];
    assert.ok(inputs.length > 0, `${name}: @example has no ${type} input to check`);
    for (const tag of inputs) {
      assert.ok(
        tag.includes(`data-slot="${slot}"`),
        `${name}: @example input omits data-slot="${slot}", so its checked state would render by colour alone: ${tag}`,
      );
    }
  }
});

// #1080: the radio example's role="radiogroup" container had no accessible
// name, so a screen reader announced "radio group" with no idea what was being
// chosen. Either aria-labelledby or a fieldset/legend satisfies this.
test('radio-group example names its group', { skip }, async () => {
  const { extractExample } = await import('../src/registry/example.js');
  const ex = extractExample(readSource('radio-group'));
  const named =
    /role="radiogroup"[^>]*aria-label(?:ledby)?=/.test(ex) ||
    /aria-label(?:ledby)?=[^>]*role="radiogroup"/.test(ex) ||
    /<legend/.test(ex);
  assert.ok(named, 'radio-group @example leaves its radiogroup unnamed');
});

// #1080: packages/ui/AGENTS.md claims "Every Tier-1 component's JSDoc carries
// an `A11y (required for accessible output)` block". That claim was false for
// ten components, which is how the guidance half of the kit's accessibility
// contract rotted unnoticed: a Tier-1 helper returns only classes, so the JSDoc
// is the ONLY place the caller learns what ARIA they owe. This test is what
// keeps the claim true, for Tier-2 as well, where the block states what the
// element already owns so an author does not double-wire it.
test('every component JSDoc carries an A11y block', { skip }, () => {
  const missing = V1_COMPONENTS.filter((name) => !/^ \* A11y/m.test(readSource(name)));
  assert.deepEqual(
    missing,
    [],
    `these components have no "A11y" JSDoc block, so a caller has no statement of what ARIA they owe: ${missing.join(', ')}`,
  );
});

// #1080: the A11y block only helps if it REACHES the agent. `webjsui view` and
// the MCP `ui` tool serve extractDocHeader(), which cuts at the first @tag, so a
// block written below @example would be silently dropped from the one surface an
// agent reads before writing UI. Assert placement, not just presence.
test('the A11y block reaches the agent-facing doc header', { skip }, async () => {
  const { extractDocHeader } = await import('../src/registry/extract.js');
  const dropped = V1_COMPONENTS.filter((name) => !/^A11y/m.test(extractDocHeader(readSource(name))));
  assert.deepEqual(
    dropped,
    [],
    `these components' A11y blocks sit below an @tag, so extractDocHeader drops them and an agent never sees the obligations: ${dropped.join(', ')}`,
  );
});

// #1245: a non-error toast carries NO role, so it resolves under exactly one
// live root (the polite viewport) instead of two nested ones.
//
// This is a SOURCE-SHAPE assertion, and it is the only layer that can catch the
// regression it guards. The obvious spelling of "no role on an ordinary toast"
// is a nullish hole, `role=${item.type === 'error' ? 'alert' : null}`, which is
// WRONG: the client renderer removes a nullish attribute but the SERVER
// renderer stringifies it, serving `role=""`, and an empty role is not a role,
// so the toast silently falls back to `generic`. The browser test in
// test/components/browser/ui-a11y.test.js runs only the client renderer, so
// `hasAttribute('role') === false` passes identically for the branch and for
// the nullish hole, which means it cannot tell them apart. The SSR layer cannot
// reach it either: `items` is an empty instance signal, so a viewport always
// renders zero toasts server-side and a toast's role never reaches the server
// renderer through markup at all. That leaves the shape of the template as the
// only observable, so assert it here.
test('sonner : branches the toast role rather than emitting a nullish hole', { skip }, () => {
  // Strip comments first. The prose in this file explains WHY role="status"
  // was removed, so a naive scan of the whole source matches the very
  // explanation and the test can never pass.
  const code = readSource('sonner')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /role="alert"/, 'an error toast still carries role=alert');
  assert.ok(
    !/role=\$\{[^}]*\}/.test(code),
    'the toast role is written as a hole, so a falsy arm serves role="" from the server renderer; branch the whole attribute instead',
  );
  assert.ok(
    !/role="status"/.test(code),
    'a non-error toast still carries role=status, which nests a second live region inside the polite viewport',
  );
});
