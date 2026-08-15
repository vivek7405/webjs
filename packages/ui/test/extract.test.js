/**
 * The shared ui-kit projector (#983): `registry/extract.js`.
 *
 * One leaf backs both `webjsui view` and the MCP `ui` tool. These assert the
 * projection shape; the MCP drift-guard (packages/mcp/test/mcp.test.mjs) asserts
 * the tool output equals this projector's output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uiComponent,
  uiInventory,
  extractHelperSignatures,
  extractDocHeader,
  renderComponentText,
} from '../src/registry/extract.js';

test('extractHelperSignatures: captures both export const arrow and export function forms', () => {
  const src =
    'export const cardClass = (opts: { size?: S } = {}): string => "x";\n' +
    'export function buttonClass(opts: O = {}): string { return "y"; }\n' +
    'export type CardSize = "sm";\n' +
    'export interface O {}\n';
  const sigs = extractHelperSignatures(src);
  assert.deepEqual(sigs, ['cardClass(opts: { size?: S } = {})', 'buttonClass(opts: O = {})']);
  assert.doesNotMatch(sigs.join(' '), /CardSize|interface/); // types/interfaces excluded
});

test('extractDocHeader: returns the lead prose, drops the @example and tags', () => {
  const src = '/**\n * Button helper.\n *\n * a11y: label icon-only buttons.\n *\n * @example\n * ```html\n * <button></button>\n * ```\n */\nexport const buttonClass = () => "x";';
  const header = extractDocHeader(src);
  assert.match(header, /Button helper/);
  assert.match(header, /a11y: label/);
  assert.doesNotMatch(header, /@example/);
  assert.doesNotMatch(header, /<button>/);
});

test('uiComponent: Tier-1 button projects helper signatures + deps', () => {
  const c = uiComponent('button');
  assert.equal(c.tier, 1);
  assert.equal(c.type, 'registry:ui');
  assert.ok(c.helpers.some((h) => h.startsWith('buttonClass(')));
  assert.ok(c.dependencies.includes('@webjsdev/core'));
});

test('uiComponent: Tier-2 dialog is tier 2 with no helper signatures', () => {
  const c = uiComponent('dialog');
  assert.equal(c.tier, 2);
  assert.deepEqual(c.helpers, []);
});

test('uiComponent: null for a non-ui / unknown name', () => {
  assert.equal(uiComponent('lib-utils'), null);
  assert.equal(uiComponent('does-not-exist'), null);
});

test('uiInventory: one entry per registry:ui component, tier-labelled, sorted', () => {
  const inv = uiInventory();
  assert.equal(inv.length, 32);
  assert.ok(inv.every((c) => c.tier === 1 || c.tier === 2));
  const names = inv.map((c) => c.name);
  assert.deepEqual(names, [...names].sort(), 'inventory is sorted by name');
});

test('renderComponentText: includes tier, helpers, and deps for a Tier-1 component', () => {
  const text = renderComponentText(uiComponent('card'));
  assert.match(text, /# card  \(Tier 1\)/);
  assert.match(text, /Helpers:/);
  assert.match(text, /cardClass/);
  assert.match(text, /npm: @webjsdev\/core/);
});
