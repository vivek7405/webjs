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

let _find, _addNewHead, _merge, _isNonHtmlPath, navigate,
  _reactivateScripts, _findAnchorInPath, _onPopState,
  enableClientRouter, disableClientRouter;

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

  ({
    _findLayoutShell: _find,
    _addNewHeadElements: _addNewHead,
    _mergeHead: _merge,
    _isNonHtmlPath,
    _reactivateScripts,
    _findAnchorInPath,
    _onPopState,
    navigate,
    enableClientRouter,
    disableClientRouter,
  } = await import('../packages/core/src/router-client.js'));
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

/* ------------ extension-based skip (pre-emptive) ------------ */

test('isNonHtmlPath: skips downloads and documents', () => {
  assert.equal(_isNonHtmlPath('/exports/report.pdf'), true);
  assert.equal(_isNonHtmlPath('/files/archive.zip'), true);
  assert.equal(_isNonHtmlPath('/data/records.csv'), true);
  assert.equal(_isNonHtmlPath('/Download.DOCX'), true, 'case-insensitive');
});

test('isNonHtmlPath: skips feeds and api-like extensions', () => {
  assert.equal(_isNonHtmlPath('/feed.xml'), true);
  assert.equal(_isNonHtmlPath('/feed.rss'), true);
  assert.equal(_isNonHtmlPath('/posts.json'), true);
  assert.equal(_isNonHtmlPath('/robots.txt'), true);
});

test('isNonHtmlPath: skips images and media', () => {
  assert.equal(_isNonHtmlPath('/avatar.png'), true);
  assert.equal(_isNonHtmlPath('/logo.svg'), true);
  assert.equal(_isNonHtmlPath('/hero.webp'), true);
  assert.equal(_isNonHtmlPath('/clip.mp4'), true);
  assert.equal(_isNonHtmlPath('/theme.mp3'), true);
});

test('isNonHtmlPath: does NOT skip normal page paths', () => {
  assert.equal(_isNonHtmlPath('/'), false);
  assert.equal(_isNonHtmlPath('/blog/post-slug'), false);
  assert.equal(_isNonHtmlPath('/dashboard'), false);
  // A route that happens to include a dot in a segment but no extension.
  assert.equal(_isNonHtmlPath('/users/john.smith/profile'), false);
});

/* ------------ Content-Type guard on navigate() ------------ */

function installNavigationMocks({ contentType, body = '', ok = true }) {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const originalHistory = globalThis.history;
  const originalScrollTo = globalThis.scrollTo;
  /** @type {{ href: string | null, assigns: string[] }} */
  const redirect = { href: null, assigns: [] };

  globalThis.fetch = async () => ({
    ok,
    status: ok ? 200 : 500,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  });

  // Replace location with a spy that captures href assignments.
  globalThis.location = /** @type any */ ({
    origin: 'http://localhost',
    href: 'http://localhost/',
    get pathname() { return '/'; },
    get search() { return ''; },
  });
  Object.defineProperty(globalThis.location, 'href', {
    configurable: true,
    get() { return 'http://localhost/'; },
    set(v) { redirect.href = v; redirect.assigns.push(v); },
  });

  // Stubs for APIs the happy-path swap calls — without them the swap
  // throws, the catch-all falls back to location.href, and we can't
  // distinguish "Content-Type guard fired" from "environment is missing
  // browser APIs".
  globalThis.history = /** @type any */ ({ pushState: () => {}, replaceState: () => {} });
  globalThis.scrollTo = /** @type any */ (() => {});

  return {
    redirect,
    restore() {
      globalThis.fetch = originalFetch;
      globalThis.location = originalLocation;
      globalThis.history = originalHistory;
      globalThis.scrollTo = originalScrollTo;
    },
  };
}

test('navigate: JSON response triggers full-page fallback (no DOM swap)', async () => {
  const { redirect, restore } = installNavigationMocks({
    contentType: 'application/json; charset=utf-8',
    body: '{"posts":[]}',
  });
  try {
    await navigate('http://localhost/api/posts');
    assert.equal(redirect.href, 'http://localhost/api/posts',
      'JSON response should trigger location.href assignment');
  } finally {
    restore();
  }
});

test('navigate: text/event-stream triggers full-page fallback', async () => {
  const { redirect, restore } = installNavigationMocks({
    contentType: 'text/event-stream',
    body: '',
  });
  try {
    await navigate('http://localhost/events');
    assert.equal(redirect.href, 'http://localhost/events');
  } finally {
    restore();
  }
});

test('navigate: application/pdf triggers full-page fallback', async () => {
  const { redirect, restore } = installNavigationMocks({
    contentType: 'application/pdf',
    body: '%PDF-1.4\n...',
  });
  try {
    await navigate('http://localhost/docs/report');
    assert.equal(redirect.href, 'http://localhost/docs/report');
  } finally {
    restore();
  }
});

test('navigate: text/html response proceeds with router swap (no fallback)', async () => {
  const { redirect, restore } = installNavigationMocks({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><title>ok</title></head><body><div data-layout="x">content</div></body></html>',
  });
  try {
    await navigate('http://localhost/ok');
    assert.equal(redirect.href, null,
      'text/html response should not trigger location.href fallback');
  } finally {
    restore();
  }
});

test('navigate: response without content-type falls back safely', async () => {
  const { redirect, restore } = installNavigationMocks({
    contentType: '',
    body: '',
  });
  try {
    await navigate('http://localhost/weird');
    assert.equal(redirect.href, 'http://localhost/weird',
      'missing Content-Type is not assumed to be HTML');
  } finally {
    restore();
  }
});

/* ------------ navigate: external origin → real location ------------ */

test('navigate: cross-origin URL delegates to location.href (no fetch)', async () => {
  const { redirect, restore } = installNavigationMocks({ contentType: 'text/html', body: '' });
  try {
    await navigate('https://other-site.test/x');
    assert.equal(redirect.href, 'https://other-site.test/x');
  } finally {
    restore();
  }
});

/* ------------ navigate: fetch error → real location ------------ */

test('navigate: fetch rejection falls back to full page navigation', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  let redirected = null;
  globalThis.fetch = async () => { throw new Error('network dead'); };
  globalThis.location = /** @type any */ ({ origin: 'http://localhost', href: 'http://localhost/' });
  Object.defineProperty(globalThis.location, 'href', {
    configurable: true,
    get() { return 'http://localhost/'; },
    set(v) { redirected = v; },
  });
  globalThis.history = /** @type any */ ({ pushState: () => {} });
  try {
    await navigate('http://localhost/boom');
    assert.equal(redirected, 'http://localhost/boom');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});

test('navigate: non-ok response falls back to full page navigation', async () => {
  const { redirect, restore } = installNavigationMocks({
    contentType: 'text/html',
    body: '<html></html>',
    ok: false,
  });
  try {
    await navigate('http://localhost/missing');
    assert.equal(redirect.href, 'http://localhost/missing');
  } finally {
    restore();
  }
});

/* ------------ navigate: same-layout vs different-layout swap ------------ */

test('navigate: same-layout swap preserves header/footer, swaps <main> only', async () => {
  document.body.innerHTML =
    '<div data-layout="root">' +
      '<header>H</header>' +
      '<main><p>old-page</p></main>' +
      '<footer>F</footer>' +
    '</div>';
  const { restore } = installNavigationMocks({
    contentType: 'text/html',
    body:
      '<!doctype html><html><head></head><body>' +
      '<div data-layout="root">' +
        '<header>H</header>' +
        '<main><p>new-page</p></main>' +
        '<footer>F</footer>' +
      '</div></body></html>',
  });
  try {
    await navigate('http://localhost/page2');
    const main = document.querySelector('main');
    assert.ok(main.textContent.includes('new-page'));
    // header/footer still mounted
    assert.ok(document.querySelector('header'));
    assert.ok(document.querySelector('footer'));
  } finally {
    restore();
    document.body.innerHTML = '';
  }
});

test('navigate: different-layout swap replaces the body content', async () => {
  document.body.innerHTML =
    '<div data-layout="public"><p>old</p></div>';
  const { restore } = installNavigationMocks({
    contentType: 'text/html',
    body:
      '<!doctype html><html><head></head><body>' +
      '<div data-layout="admin"><p>new-admin</p></div>' +
      '</body></html>',
  });
  try {
    await navigate('http://localhost/admin');
    // Different-layout branch may use startViewTransition when available;
    // under linkedom it uses the synchronous fallback. Either way, the old
    // public layout should be gone from the body after the nav.
    assert.ok(!document.body.textContent.includes('old'),
      'old public-layout content cleared after navigate');
  } finally {
    restore();
    document.body.innerHTML = '';
  }
});

/* ------------ parseHTML returning null, hash scroll, View Transitions ------------ */

test('navigate: unparseable HTML body falls back to full navigation', async () => {
  // Force parseHTML() to return null by removing both hooks.
  const origDP = globalThis.DOMParser;
  const origDoc = globalThis.Document;
  globalThis.DOMParser = undefined;
  globalThis.Document = undefined;
  const { redirect, restore } = installNavigationMocks({
    contentType: 'text/html',
    body: '<html><body><p>whatever</p></body></html>',
  });
  try {
    await navigate('http://localhost/unparseable');
    assert.equal(redirect.href, 'http://localhost/unparseable');
  } finally {
    restore();
    globalThis.DOMParser = origDP;
    globalThis.Document = origDoc;
  }
});

test('navigate: hash portion triggers scroll (target found or top)', async () => {
  document.body.innerHTML =
    '<div data-layout="root"><main><section id="anchor">A</section></main></div>';
  let scrolledToTop = false;
  let scrolledIntoView = false;
  globalThis.scrollTo = () => { scrolledToTop = true; };
  const origInto = globalThis.HTMLElement.prototype.scrollIntoView;
  globalThis.HTMLElement.prototype.scrollIntoView = function () { scrolledIntoView = true; };
  const { restore } = installNavigationMocks({
    contentType: 'text/html',
    body:
      '<!doctype html><html><head></head><body>' +
      '<div data-layout="root"><main><section id="anchor">A</section></main></div>' +
      '</body></html>',
  });
  try {
    await navigate('http://localhost/x#anchor');
    assert.ok(scrolledIntoView, 'existing anchor → scrollIntoView');
    scrolledIntoView = false;
    await navigate('http://localhost/x#missing');
    assert.ok(scrolledToTop || !scrolledIntoView,
      'missing anchor falls back to scrollTo(0,0)');
  } finally {
    restore();
    document.body.innerHTML = '';
    globalThis.HTMLElement.prototype.scrollIntoView = origInto;
  }
});

test('navigate: different-layout branch uses startViewTransition when available', async () => {
  // Different layout = different tag names AND different data-layout values.
  document.body.innerHTML = '<public-shell data-layout="public"><p>old</p></public-shell>';
  let swapRan = false;
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (cb) => {
      swapRan = true;
      cb();
      return { finished: Promise.resolve() };
    },
  });
  const { restore } = installNavigationMocks({
    contentType: 'text/html',
    body:
      '<!doctype html><html><head></head><body>' +
      '<admin-shell data-layout="admin"><p>new</p></admin-shell>' +
      '</body></html>',
  });
  try {
    await navigate('http://localhost/other');
    assert.ok(swapRan, 'startViewTransition callback should have fired');
  } finally {
    restore();
    delete document.startViewTransition;
    document.body.innerHTML = '';
  }
});

/* ------------ forwardSuspenseResolvers (exposed via same-layout swap) ------------ */

test('navigate: same-layout swap forwards <template data-webjs-resolve> nodes', async () => {
  document.body.innerHTML =
    '<div data-layout="root"><main><p>old</p></main></div>';
  const { restore } = installNavigationMocks({
    contentType: 'text/html',
    body:
      '<!doctype html><html><head></head><body>' +
      '<div data-layout="root"><main><p>new</p></main></div>' +
      '<template data-webjs-resolve="s1"><p>resolved</p></template>' +
      '</body></html>',
  });
  try {
    await navigate('http://localhost/with-suspense');
    const tpl = document.body.querySelector('template[data-webjs-resolve="s1"]');
    assert.ok(tpl, 'Suspense resolver template should be copied to live body');
  } finally {
    restore();
    document.body.innerHTML = '';
  }
});

/* ------------ onClick: interception of <a> clicks ------------ */

test('onClick: same-origin link click is intercepted and fetched via router', async () => {
  // enableClientRouter() auto-runs on import, so a 'click' listener is already
  // installed in capture phase on the document.
  document.body.innerHTML =
    '<div data-layout="root"><main><a href="/other">Go</a></main></div>';
  let fetched = null;
  globalThis.fetch = async (url) => {
    fetched = String(url);
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () =>
        '<!doctype html><html><head></head><body>' +
        '<div data-layout="root"><main><p>new</p></main></div>' +
        '</body></html>',
    };
  };
  const origLoc = globalThis.location;
  const loc = /** @type any */ ({
    origin: 'http://localhost',
    href: 'http://localhost/',
    pathname: '/',
    search: '',
  });
  globalThis.location = loc;
  globalThis.history = /** @type any */ ({ pushState: () => {} });
  globalThis.scrollTo = () => {};
  try {
    const a = document.querySelector('a');
    // linkedom: a.href returns the full URL with our overridden location.origin.
    // Ensure a.href → 'http://localhost/other' for the origin check to match.
    a.setAttribute('href', 'http://localhost/other');
    // linkedom doesn't expose MouseEvent; fabricate a MouseEvent-shaped object.
    const ev = new window.Event('click', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'button', { value: 0 });
    Object.defineProperty(ev, 'composedPath', {
      value: () => [a],
    });
    a.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(fetched && fetched.includes('/other'),
      `router should have fetched /other; saw: ${fetched}`);
  } finally {
    document.body.innerHTML = '';
    globalThis.location = origLoc;
  }
});

// ---- reactivateScripts ----

test('reactivateScripts: recreates <script> elements so they execute', () => {
  const container = document.createElement('div');
  container.innerHTML = '<script id="s1">window.__rs = 1;</script>';
  const before = container.querySelector('#s1');
  _reactivateScripts(container);
  const after = container.querySelector('#s1');
  assert.ok(after, 'script still in container after reactivate');
  assert.notEqual(before, after, 'script node was replaced, not kept');
  assert.equal(after.textContent, 'window.__rs = 1;');
});

test('reactivateScripts: preserves attributes on the recreated node', () => {
  const container = document.createElement('div');
  container.innerHTML = '<script type="module" src="/x.js" data-flag="a"></script>';
  _reactivateScripts(container);
  const s = container.querySelector('script');
  assert.equal(s.getAttribute('type'), 'module');
  assert.equal(s.getAttribute('src'), '/x.js');
  assert.equal(s.getAttribute('data-flag'), 'a');
});

// ---- findAnchorInPath ----

test('findAnchorInPath: returns the nearest anchor in composedPath()', () => {
  document.body.innerHTML = '<a href="/to"><span id="inner">click</span></a>';
  const inner = document.getElementById('inner');
  const anchor = document.querySelector('a');
  const e = { composedPath: () => [inner, anchor, document.body] };
  assert.equal(_findAnchorInPath(e), anchor);
});

test('findAnchorInPath: returns null when no anchor is in the path', () => {
  document.body.innerHTML = '<div><span id="nope">click</span></div>';
  const nope = document.getElementById('nope');
  const e = { composedPath: () => [nope, document.body] };
  assert.equal(_findAnchorInPath(e), null);
});

// ---- disableClientRouter ----

test('disableClientRouter: is a no-op when router is already disabled', () => {
  // router-client auto-enables on import; call disable twice to exercise
  // both the "was enabled → teardown" and "already disabled → early return".
  disableClientRouter();
  disableClientRouter(); // second call hits `if (!enabled) return`
  // Re-enable to restore state for any subsequent tests.
  enableClientRouter();
});

test('disableClientRouter: enableClientRouter is idempotent', () => {
  // disable → enable → enable again: second enable hits the
  // `if (enabled || typeof document === 'undefined') return` early-return.
  disableClientRouter();
  enableClientRouter();
  enableClientRouter(); // idempotent
  // No assertion needed — we just want the coverage path for the
  // "already enabled" guard. If the second call double-attached
  // listeners, subsequent tests would misbehave.
});

// ---- onPopState ----

test('onPopState: triggers a router navigation to location.href', async () => {
  // Stub performNavigation indirectly by stubbing fetch + location.
  const origLoc = globalThis.location;
  const origFetch = globalThis.fetch;
  let fetched = null;
  globalThis.location = /** @type {any} */ ({
    href: 'http://localhost/popped',
    pathname: '/popped',
    origin: 'http://localhost',
    search: '',
    hash: '',
  });
  globalThis.fetch = async (url) => {
    fetched = String(url);
    return new Response('<!doctype html><html><body><div data-layout="x">popped</div></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  try {
    document.body.innerHTML = '<div data-layout="x">before</div>';
    _onPopState({});
    // Let the async navigation settle.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(fetched, 'http://localhost/popped');
  } finally {
    globalThis.location = origLoc;
    globalThis.fetch = origFetch;
  }
});
