/**
 * Unit tests for router-client internals (data-layout detection, add-only
 * head merge, mergeHead with script recreation). Uses linkedom for a
 * DOM-compatible environment.
 *
 * The router-client auto-enables on import (enableClientRouter() at EOM),
 * so we set up globals BEFORE the import.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

let _find, _addNewHead, _merge;

before(async () => {
  const { window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  // Copy the needed DOM constructors/globals onto the Node globalThis so
  // the router-client module can resolve them.
  globalThis.document = window.document;
  globalThis.window = window;
  globalThis.DocumentFragment = window.DocumentFragment;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLAnchorElement = window.HTMLAnchorElement;
  globalThis.HTMLTemplateElement = window.HTMLTemplateElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Comment = window.Comment;
  globalThis.Text = window.Text;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.customElements = window.customElements;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.DOMParser = window.DOMParser;

  ({ _findLayoutShell: _find, _addNewHeadElements: _addNewHead, _mergeHead: _merge } =
    await import('../packages/core/src/router-client.js'));
});

test('findLayoutShell: detects data-layout element on direct body child', () => {
  const body = document.createElement('body');
  body.innerHTML = '<div data-layout="app/layout">inner</div>';
  const shell = _find(body);
  assert.ok(shell);
  assert.equal(shell.getAttribute('data-layout'), 'app/layout');
});

test('findLayoutShell: falls back to first custom element if no data-layout', () => {
  const body = document.createElement('body');
  body.innerHTML = '<div>ignored</div><blog-shell>hi</blog-shell>';
  const shell = _find(body);
  assert.ok(shell);
  assert.equal(shell.tagName.toLowerCase(), 'blog-shell');
});

test('findLayoutShell: returns null when no shell is present', () => {
  const body = document.createElement('body');
  body.innerHTML = '<p>just plain html</p>';
  assert.equal(_find(body), null);
});

test('findLayoutShell: data-layout takes precedence over custom element', () => {
  const body = document.createElement('body');
  body.innerHTML = '<div data-layout="x">A</div><blog-shell>B</blog-shell>';
  const shell = _find(body);
  assert.equal(shell.getAttribute('data-layout'), 'x');
});

test('addNewHeadElements: updates <title> from new head', () => {
  document.head.innerHTML = '<title>Old</title>';
  const newHead = document.createElement('head');
  newHead.innerHTML = '<title>New</title>';
  _addNewHead(newHead);
  assert.equal(document.title, 'New');
});

test('addNewHeadElements: adds NEW link/style elements, preserves existing', () => {
  document.head.innerHTML =
    '<title>T</title>' +
    '<style id="runtime-css">.a{color:red}</style>' +
    '<link rel="stylesheet" href="/existing.css">';

  const newHead = document.createElement('head');
  newHead.innerHTML =
    '<title>T</title>' +
    '<link rel="stylesheet" href="/existing.css">' +
    '<link rel="modulepreload" href="/new-module.js">';

  _addNewHead(newHead);

  // Runtime-generated CSS must survive.
  assert.ok(
    document.head.querySelector('#runtime-css'),
    'runtime CSS element should not be removed'
  );
  // New modulepreload link should be added.
  assert.ok(
    document.head.querySelector('link[rel="modulepreload"][href="/new-module.js"]'),
    'new modulepreload should be added'
  );
  // Existing link should stay (not duplicated).
  const existing = document.head.querySelectorAll('link[href="/existing.css"]');
  assert.equal(existing.length, 1);
});

test('addNewHeadElements: skips importmap/base/title for addition', () => {
  document.head.innerHTML = '<script type="importmap">{}</script><base href="/">';
  const newHead = document.createElement('head');
  newHead.innerHTML =
    '<script type="importmap">{"imports":{}}</script>' +
    '<base href="/app/">' +
    '<title>title</title>';
  _addNewHead(newHead);
  // Importmap and base in new head must NOT be cloned across.
  const importMaps = document.head.querySelectorAll('script[type="importmap"]');
  assert.equal(importMaps.length, 1, 'existing importmap untouched');
  const bases = document.head.querySelectorAll('base');
  assert.equal(bases.length, 1, 'existing base untouched');
});

test('addNewHeadElements: script elements are recreated (not cloned) to execute', () => {
  document.head.innerHTML = '';
  const newHead = document.createElement('head');
  const s = document.createElement('script');
  s.setAttribute('src', '/foo.js');
  s.setAttribute('type', 'module');
  newHead.appendChild(s);
  _addNewHead(newHead);
  const added = document.head.querySelector('script[src="/foo.js"]');
  assert.ok(added, 'script should be added');
  assert.notStrictEqual(added, s, 'script element should be a new node, not a clone');
  assert.equal(added.getAttribute('type'), 'module');
});

test('mergeHead: removes elements not in the new head', () => {
  document.head.innerHTML =
    '<title>Old</title>' +
    '<link rel="stylesheet" href="/stale.css">' +
    '<link rel="stylesheet" href="/shared.css">';
  const newHead = document.createElement('head');
  newHead.innerHTML =
    '<title>New</title>' +
    '<link rel="stylesheet" href="/shared.css">' +
    '<link rel="stylesheet" href="/fresh.css">';
  _merge(newHead);
  assert.equal(document.title, 'New');
  assert.ok(!document.head.querySelector('link[href="/stale.css"]'), 'stale link removed');
  assert.ok(document.head.querySelector('link[href="/shared.css"]'), 'shared link kept');
  assert.ok(document.head.querySelector('link[href="/fresh.css"]'), 'fresh link added');
});

test('mergeHead: preserves importmap and base across full merges', () => {
  document.head.innerHTML =
    '<script type="importmap">{}</script>' +
    '<base href="/">' +
    '<link rel="stylesheet" href="/x.css">';
  const newHead = document.createElement('head');
  newHead.innerHTML = '<link rel="stylesheet" href="/y.css">';
  _merge(newHead);
  assert.ok(
    document.head.querySelector('script[type="importmap"]'),
    'importmap kept'
  );
  assert.ok(document.head.querySelector('base'), 'base kept');
  assert.ok(!document.head.querySelector('link[href="/x.css"]'), 'x.css removed');
  assert.ok(document.head.querySelector('link[href="/y.css"]'), 'y.css added');
});

test('mergeHead: re-creates script elements so they execute', () => {
  document.head.innerHTML = '';
  const newHead = document.createElement('head');
  const s = document.createElement('script');
  s.setAttribute('src', '/merge.js');
  s.setAttribute('type', 'module');
  newHead.appendChild(s);
  _merge(newHead);
  const added = document.head.querySelector('script[src="/merge.js"]');
  assert.ok(added);
  assert.notStrictEqual(added, s, 'script re-created so browser executes it');
  assert.equal(added.getAttribute('type'), 'module');
});
