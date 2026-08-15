/**
 * Unit tests for Tier-1 class-helper functions: pure functions that return
 * Tailwind class strings. No DOM, no browser, no custom-element machinery.
 *
 * These used to live in `test/browser/ui-visual.test.js` and
 * `test/browser/ui-composite.test.js`, where they mounted nonexistent custom
 * elements (`<ui-button>`, `<ui-card>`, …) and failed. After the Tier-1/Tier-2
 * refactor, Tier-1 components are functions: the right test shape is to
 * call them and assert on the returned string. That's all this file does.
 *
 * Tier-2 custom-element tests still live under `test/browser/` because they
 * need real DOM mount + interaction.
 *
 * Node 22+ imports `.ts` natively, so this file imports the registry sources
 * directly with no transpile step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'registry',
  'components',
);

const skip = !existsSync(join(COMPONENTS_DIR, 'button.ts'));

/** Call a value if it's a function, otherwise return it as-is. */
function resolve(v) {
  return typeof v === 'function' ? v() : v;
}

/** Assert a class-helper export is present and returns a non-trivial string. */
function assertHelper(mod, name) {
  assert.ok(name in mod, `${name} not exported`);
  const out = resolve(mod[name]);
  assert.equal(typeof out, 'string', `${name} did not resolve to a string`);
  assert.ok(out.length > 0, `${name} resolved to empty string`);
}

// ---------- button ----------

test('buttonClass: default variant + size', { skip }, async () => {
  const { buttonClass } = await import(join(COMPONENTS_DIR, 'button.ts'));
  const s = buttonClass();
  assert.match(s, /bg-primary/);
  assert.match(s, /text-primary-foreground/);
  assert.match(s, /hover:bg-primary\/90/);
  assert.match(s, /h-9/); // default size
});

test('buttonClass: variant strings', { skip }, async () => {
  const { buttonClass } = await import(join(COMPONENTS_DIR, 'button.ts'));
  assert.match(buttonClass({ variant: 'destructive' }), /bg-destructive/);
  assert.match(buttonClass({ variant: 'secondary' }), /bg-secondary/);
  assert.match(buttonClass({ variant: 'outline' }), /border/);
  assert.match(buttonClass({ variant: 'outline' }), /hover:bg-accent/);
  assert.match(buttonClass({ variant: 'ghost' }), /hover:bg-accent/);
  assert.doesNotMatch(buttonClass({ variant: 'ghost' }), /bg-primary\b/);
  assert.match(buttonClass({ variant: 'link' }), /underline-offset-4/);
});

test('buttonClass: size strings', { skip }, async () => {
  const { buttonClass } = await import(join(COMPONENTS_DIR, 'button.ts'));
  assert.match(buttonClass({ size: 'xs' }), /h-6/);
  assert.match(buttonClass({ size: 'sm' }), /h-8/);
  assert.match(buttonClass({ size: 'lg' }), /h-10/);
  assert.match(buttonClass({ size: 'icon' }), /size-9/);
  assert.match(buttonClass({ size: 'icon-xs' }), /size-6/);
  assert.match(buttonClass({ size: 'icon-sm' }), /size-8/);
  assert.match(buttonClass({ size: 'icon-lg' }), /size-10/);
});

// ---------- badge ----------

test('badgeClass: variants', { skip }, async () => {
  const { badgeClass } = await import(join(COMPONENTS_DIR, 'badge.ts'));
  assert.match(badgeClass(), /bg-primary/);
  assert.match(badgeClass({ variant: 'secondary' }), /bg-secondary/);
  assert.match(badgeClass({ variant: 'destructive' }), /bg-destructive/);
  assert.doesNotMatch(badgeClass({ variant: 'outline' }), /bg-primary\b/);
});

// ---------- alert ----------

test('alert: class helpers expose role + variant', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'alert.ts'));
  assert.match(mod.alertClass(), /relative/);
  assert.match(mod.alertClass({ variant: 'destructive' }), /text-destructive/);
  assertHelper(mod, 'alertTitleClass');
  assertHelper(mod, 'alertDescriptionClass');
});

// ---------- card ----------

test('card: exposes 7 subpart helpers', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'card.ts'));
  for (const name of [
    'cardClass',
    'cardHeaderClass',
    'cardTitleClass',
    'cardDescriptionClass',
    'cardActionClass',
    'cardContentClass',
    'cardFooterClass',
  ]) {
    assertHelper(mod, name);
  }
  assert.match(mod.cardClass(), /rounded-/);
});

// ---------- avatar ----------

test('avatar: exposes 6 subpart helpers', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'avatar.ts'));
  assert.equal(typeof mod.avatarClass, 'function');
  for (const name of [
    'avatarImageClass',
    'avatarFallbackClass',
    'avatarBadgeClass',
    'avatarGroupClass',
    'avatarGroupCountClass',
  ]) {
    assertHelper(mod, name);
  }
});

// ---------- table ----------

test('table: 9 subpart helpers', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'table.ts'));
  for (const name of [
    'tableContainerClass',
    'tableClass',
    'tableHeaderClass',
    'tableBodyClass',
    'tableFooterClass',
    'tableRowClass',
    'tableHeadClass',
    'tableCellClass',
    'tableCaptionClass',
  ]) {
    assertHelper(mod, name);
  }
});

// ---------- input / textarea / label ----------

test('input / textarea / label: helper strings', { skip }, async () => {
  const input = await import(join(COMPONENTS_DIR, 'input.ts'));
  const textarea = await import(join(COMPONENTS_DIR, 'textarea.ts'));
  const label = await import(join(COMPONENTS_DIR, 'label.ts'));
  assert.match(input.inputClass(), /border/);
  assert.match(textarea.textareaClass(), /border/);
  assert.match(label.labelClass(), /text-sm/);
});

// ---------- visual primitives ----------

test('separator / skeleton / aspect-ratio / kbd: helpers exist', { skip }, async () => {
  const sep = await import(join(COMPONENTS_DIR, 'separator.ts'));
  const skel = await import(join(COMPONENTS_DIR, 'skeleton.ts'));
  const ar = await import(join(COMPONENTS_DIR, 'aspect-ratio.ts'));
  const kbd = await import(join(COMPONENTS_DIR, 'kbd.ts'));

  // separator is a function (takes orientation)
  assert.match(sep.separatorClass(), /shrink-0/);
  assert.match(sep.separatorClass({ orientation: 'vertical' }), /h-full|w-px/);

  assert.match(skel.skeletonClass(), /animate-pulse/);
  assert.match(ar.aspectRatioClass(), /relative/);
  assertHelper(kbd, 'kbdClass');
  assertHelper(kbd, 'kbdGroupClass');
});

// ---------- form primitives that are class helpers (no <ui-*>) ----------

test('checkbox / switch / radio-group / toggle: class helpers (not custom elements)', { skip }, async () => {
  const cb = await import(join(COMPONENTS_DIR, 'checkbox.ts'));
  const sw = await import(join(COMPONENTS_DIR, 'switch.ts'));
  const rg = await import(join(COMPONENTS_DIR, 'radio-group.ts'));
  const tg = await import(join(COMPONENTS_DIR, 'toggle.ts'));

  assert.equal(typeof cb.checkboxClass, 'function');
  assert.equal(typeof sw.switchInputClass, 'function');
  assert.equal(typeof sw.switchTrackClass, 'function');
  assertHelper(rg, 'radioGroupClass');
  assertHelper(rg, 'radioClass');
  assert.equal(typeof tg.toggleClass, 'function');
});

test('toggle: variant + size accepted', { skip }, async () => {
  const { toggleClass } = await import(join(COMPONENTS_DIR, 'toggle.ts'));
  assert.ok(toggleClass().length > 10);
  assert.match(toggleClass({ variant: 'outline' }), /border/);
});

test('progress: progressClass over native <progress>', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'progress.ts'));
  assertHelper(mod, 'progressClass');
  // Both vendor pseudo-elements styled for the bar fill.
  assert.match(mod.progressClass(), /\[&::-webkit-progress-value\]:bg-primary/);
  assert.match(mod.progressClass(), /\[&::-moz-progress-bar\]:bg-primary/);
  // Module exports the class helper only, no custom-element side effects.
  assert.equal(mod.UiProgress, undefined, 'UiProgress class no longer exported');
});

// ---------- breadcrumb / pagination ----------

test('breadcrumb: 6 subpart helpers', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'breadcrumb.ts'));
  for (const name of [
    'breadcrumbListClass',
    'breadcrumbItemClass',
    'breadcrumbLinkClass',
    'breadcrumbPageClass',
    'breadcrumbSeparatorClass',
    'breadcrumbEllipsisClass',
  ]) {
    assertHelper(mod, name);
  }
});

test('pagination: helpers including variant-driven link', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'pagination.ts'));
  assert.equal(typeof mod.paginationLinkClass, 'function');
  const active = mod.paginationLinkClass({ isActive: true });
  const inactive = mod.paginationLinkClass({ isActive: false });
  assert.notEqual(active, inactive, 'active variant differs from inactive');
});

// ---------- native-select ----------

test('native-select: wrapper + select + option helpers', { skip }, async () => {
  const mod = await import(join(COMPONENTS_DIR, 'native-select.ts'));
  for (const name of [
    'nativeSelectWrapperClass',
    'nativeSelectClass',
    'nativeSelectIconClass',
    'nativeSelectOptionClass',
    'nativeSelectOptGroupClass',
  ]) {
    assertHelper(mod, name);
  }
});
