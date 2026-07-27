/**
 * Browser tests for <preview-tabs>, the Preview / Code toggle wrapping every
 * demo in the component gallery.
 *
 * The element declares the ARIA tab pattern (`tablist` / `tab` / `tabpanel`),
 * and these assert it actually implements what those roles promise: the panels
 * are cross-linked to their tabs, focus roves so Tab enters the group once, and
 * Arrow / Home / End move between tabs. It previously declared the roles with
 * none of the wiring, which announces to a screen reader as tabs with no
 * associated panel, and it now sits on 33 indexed pages.
 *
 * Real-browser rather than SSR assertions because every property under test is
 * keyboard and focus behaviour, which only exists after upgrade.
 */
import '#components/preview-tabs.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  const host = document.createElement('preview-tabs');
  host.innerHTML = '<div slot="preview">DEMO</div><div slot="code"><pre>SRC</pre></div>';
  document.body.appendChild(host);
  await host.updateComplete;
  await tick();
  return host;
}

const q = (host, sel) => host.shadowRoot.querySelector(sel);
const tabs = (host) => [...host.shadowRoot.querySelectorAll('[role="tab"]')];

suite('preview-tabs', () => {
  let mounted = [];
  const track = async () => { const h = await mount(); mounted.push(h); return h; };
  teardown(() => { mounted.forEach((h) => h.remove()); mounted = []; });

  test('cross-links each tab to the panel it controls', async () => {
  const host = await track();
  for (const name of ['preview', 'code']) {
    const tab = q(host, `#tab-${name}`);
    const panel = q(host, `#panel-${name}`);
    assert.ok(tab, `${name} tab exists`);
    assert.ok(panel, `${name} panel exists`);
    assert.equal(tab.getAttribute('aria-controls'), `panel-${name}`, `${name} tab points at its panel`);
    assert.equal(panel.getAttribute('role'), 'tabpanel', `${name} panel declares its role`);
    assert.equal(panel.getAttribute('aria-labelledby'), `tab-${name}`, `${name} panel names itself from its tab`);
  }
  });

  test('roves tabindex so the group is a single tab stop', async () => {
  const host = await track();
  const [preview, code] = tabs(host);
  assert.equal(preview.getAttribute('tabindex'), '0', 'the selected tab is focusable');
  assert.equal(code.getAttribute('tabindex'), '-1', 'the unselected tab is skipped');

  code.click();
  await host.updateComplete;
  assert.equal(preview.getAttribute('tabindex'), '-1', 'focus moves with selection');
  assert.equal(code.getAttribute('tabindex'), '0');
  });

  test('selects with Arrow, Home, and End', async () => {
  const host = await track();
  const bar = q(host, '[role="tablist"]');
  const press = async (key) => {
    bar.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
    await host.updateComplete;
  };
  const selected = () => tabs(host).find((t) => t.getAttribute('aria-selected') === 'true').id;

  assert.equal(selected(), 'tab-preview', 'starts on Preview');
  await press('ArrowRight');
  assert.equal(selected(), 'tab-code', 'ArrowRight moves to Code');
  await press('ArrowLeft');
  assert.equal(selected(), 'tab-preview', 'ArrowLeft moves back');
  await press('End');
  assert.equal(selected(), 'tab-code', 'End selects the last tab');
  await press('Home');
  assert.equal(selected(), 'tab-preview', 'Home selects the first tab');
  });

  test('shows exactly one panel at a time, and keeps both slots mounted', async () => {
  // Both slots must stay in the tree: the projected demo contains ui-* elements
  // that capture their innerHTML on connect, so a rebuild would be destructive.
  // Only the hidden attribute moves.
  const host = await track();
  const preview = q(host, '#panel-preview');
  const code = q(host, '#panel-code');

  assert.ok(!preview.hasAttribute('hidden'), 'preview visible initially');
  assert.ok(code.hasAttribute('hidden'), 'code hidden initially');

  q(host, '#tab-code').click();
  await host.updateComplete;

  assert.ok(preview.hasAttribute('hidden'), 'preview hidden after toggle');
  assert.ok(!code.hasAttribute('hidden'), 'code visible after toggle');
  assert.equal(q(host, '#panel-preview'), preview, 'the preview slot is the same node, not rebuilt');
  assert.equal(host.querySelector('[slot="preview"]').textContent, 'DEMO', 'and its projected content survives');
  });

  test('keeps each instance independent', async () => {
  // The mode is an instance signal, so two toggles on one page (a component
  // page renders several) must not move together.
  const a = await track();
  const b = await track();
  q(a, '#tab-code').click();
  await a.updateComplete;
  await b.updateComplete;
  assert.equal(q(a, '#tab-code').getAttribute('aria-selected'), 'true', 'the clicked one flips');
  assert.equal(q(b, '#tab-preview').getAttribute('aria-selected'), 'true', 'the other does not');
  });
});
