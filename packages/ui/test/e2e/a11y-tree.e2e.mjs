/**
 * Accessibility-tree e2e for the two needs-runtime-check findings from #1080
 * (tracked by #1245).
 *
 * Those two findings could not be settled by a DOM assertion, which is what
 * `test/components/browser/ui-a11y.test.js` already does: an attribute
 * assertion re-checks the INPUT and never the computed OUTPUT. What a screen
 * reader consumes is the platform accessibility tree, so this file asserts
 * against that tree directly, read over CDP from real Chromium.
 *
 * Finding 1, double-role nesting: dialog and alert-dialog each render a native
 * `<dialog>` (implicit `role=dialog`) wrapping an inner div that carried the
 * ARIA. Two nested dialog-ish roles risk the outer one being what assistive
 * tech reports, which for alert-dialog would drop the `alertdialog` role and
 * the more urgent announcement it triggers. The assertions below pin exactly
 * ONE dialog-family node in the chain, and pin which role it carries.
 *
 * Finding 2, nested live regions: the sonner viewport is a persistent polite
 * live region and each toast carried its own `role="status"` / `role="alert"`,
 * both implicit live regions. The assertions pin how many live roots a toast
 * resolves under, and the politeness of each.
 *
 * What this file does NOT answer is whether a reader SPEAKS a toast twice.
 * That is the reader's announcement queue, one layer above the tree, and it is
 * not a browser artifact. It stays a manual pass, recorded on #1245.
 *
 * Two CDP facts worth not re-deriving by trial and error:
 *   - `properties` is an ARRAY of `{ name, value: { type, value } }`, with key
 *     names `live` / `atomic` / `relevant` / `modal` / `focusable`.
 *   - An open modal DROPS every node outside the top layer from the tree
 *     entirely. They are absent, not returned with `ignored: true`. So probe
 *     sonner with no dialog open, and probe a dialog only while it is open.
 *
 * Self-contained: boots the site, runs the checks, tears down. Needs Playwright
 * plus a browser. Run: `node packages/ui/test/e2e/a11y-tree.e2e.mjs`. Skips with
 * a clear message if Playwright or a browser is unavailable.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE = resolve(HERE, '../../../../website');
const PORT = Number(process.env.WEBJS_E2E_A11Y_PORT || 5182);
const BASE = `http://localhost:${PORT}`;

function fail(msg) { console.error('FAIL: ' + msg); process.exitCode = 1; }

let pw;
try {
  pw = (await import('playwright')).default ?? (await import('playwright'));
} catch {
  console.log('SKIP a11y-tree e2e: playwright not installed.');
  process.exit(0);
}

// Boot the site (mirrors the registry sources in, then `webjs start`).
const cli = resolve(WEBSITE, '../node_modules/@webjsdev/cli/bin/webjs.js');
spawn(process.execPath, [resolve(WEBSITE, 'scripts/copy-registry.mjs')], { cwd: WEBSITE, stdio: 'ignore' });
await sleep(800);
const server = spawn(process.execPath, [cli, 'start', '--port', String(PORT)], {
  cwd: WEBSITE,
  stdio: 'ignore',
  env: { ...process.env, WEBJS_E2E_A11Y: '1' },
});
const teardown = () => { try { server.kill('SIGTERM'); } catch { /* ignore */ } };
process.on('exit', teardown);

// Wait for readiness.
let up = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(BASE + '/__webjs/ready').catch(() => null);
    if (r && r.ok) { up = true; break; }
  } catch { /* retry */ }
  await sleep(500);
}
if (!up) { fail('the gallery site did not become ready'); teardown(); process.exit(1); }

// Headless is verified to return a fully populated tree, so CI needs no display
// server. A desktop context, NOT the iPhone descriptor `touch.e2e.mjs` uses:
// this file is testing the accessibility tree, not touch.
let browser;
try {
  browser = await pw.chromium.launch({ headless: true });
} catch (e) {
  console.log('SKIP a11y-tree e2e: could not launch Chromium (' + String(e.message).split('\n')[0] + ').');
  teardown();
  process.exit(0);
}

const ctx = await browser.newContext();
const page = await ctx.newPage();
const results = [];
const notes = [];

const cdp = await ctx.newCDPSession(page);
await cdp.send('Accessibility.enable');
await cdp.send('DOM.enable');

const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);

/** A named property's raw value off an AXNode, or undefined. */
const propOf = (node, name) => (node.properties || []).find((p) => p.name === name)?.value?.value;

/** backendDOMNodeId for a CSS selector, or null when the selector misses. */
async function backendIdFor(selector) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  const { node } = await cdp.send('DOM.describeNode', { nodeId });
  return node.backendNodeId;
}

/**
 * AX chain from the element matching `selector` up to the root, nearest first.
 * Walks `parentId` / `nodeId`, which are AX-tree-local strings; the numeric
 * `backendDOMNodeId` is only how a DOM node crosses into its AX node.
 */
async function axChain(selector) {
  const backendId = await backendIdFor(selector);
  if (backendId == null) return null;
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  let cur = nodes.find((n) => n.backendDOMNodeId === backendId);
  if (!cur) return null;
  const chain = [];
  while (cur) { chain.push(cur); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return chain;
}

/** A null chain is a FAILED check, never a skipped one. */
function chainMissing(label, selector) {
  results.push([label + ' (selector did not resolve to an AX node: ' + selector + ')', false]);
}

const dialogNodesIn = (chain) => chain.filter((n) => DIALOG_ROLES.has(n.role?.value) && !n.ignored);
const liveNodesIn = (chain) => chain.filter((n) => propOf(n, 'live') !== undefined);

// ---------------------------------------------------------------------------
// 1) dialog, titled path. The gallery title is an <h2> with no
// data-slot="dialog-title", so the name resolves through wireDialogLabels()'s
// `h1, h2, h3` fallback. That is the common path, and the one being asserted.
// ---------------------------------------------------------------------------
await page.goto(BASE + '/ui/dialog', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('ui-dialog-trigger button')]
    .find((b) => /open dialog/i.test(b.textContent || ''));
  btn?.click();
});
await page.waitForTimeout(700);

const DIALOG_PANEL = 'dialog[data-slot="dialog-native"][open] [data-slot="dialog-content"]';
{
  const chain = await axChain(DIALOG_PANEL);
  if (!chain) {
    chainMissing('dialog exposes exactly one dialog-family node', DIALOG_PANEL);
  } else {
    const dlgs = dialogNodesIn(chain);
    notes.push('dialog: ' + dlgs.length + ' dialog-family node(s), roles=['
      + dlgs.map((n) => n.role?.value).join(', ') + '], name='
      + JSON.stringify(dlgs[0]?.name?.value ?? null));
    results.push(['dialog exposes exactly one dialog-family node', dlgs.length === 1]);
    results.push(['dialog takes its name from the title', dlgs[0]?.name?.value === 'Edit profile']);
    results.push(['dialog is exposed as modal', propOf(dlgs[0], 'modal') === true]);
  }
}

// ---------------------------------------------------------------------------
// 2) dialog, title-less path. Built in the page rather than added to the
// gallery, so no registry or website surface changes. Asserts the #1230
// generic-name fallback still lands on whichever node owns the role.
// ---------------------------------------------------------------------------
// Append and open in SEPARATE steps. The host defers its open to a microtask
// and needs `<ui-dialog-content>` upgraded and rendered first, so appending and
// calling show() in one evaluate opens nothing.
await page.evaluate(() => {
  document.querySelector('ui-dialog')?.hide?.();
  const host = document.createElement('ui-dialog');
  host.id = 'untitled-probe';
  host.innerHTML = '<ui-dialog-content><p>No title here.</p></ui-dialog-content>';
  document.body.appendChild(host);
});
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('untitled-probe')?.show?.());
await page.waitForTimeout(700);

const UNTITLED_DIALOG_PANEL = '#untitled-probe dialog[data-slot="dialog-native"][open] [data-slot="dialog-content"]';
{
  const chain = await axChain(UNTITLED_DIALOG_PANEL);
  if (!chain) {
    chainMissing('title-less dialog exposes exactly one dialog-family node', UNTITLED_DIALOG_PANEL);
  } else {
    const dlgs = dialogNodesIn(chain);
    notes.push('dialog (title-less): ' + dlgs.length + ' dialog-family node(s), name='
      + JSON.stringify(dlgs[0]?.name?.value ?? null));
    results.push(['title-less dialog exposes exactly one dialog-family node', dlgs.length === 1]);
    results.push(['title-less dialog falls back to the generic name', dlgs[0]?.name?.value === 'Dialog']);
  }
}
await page.evaluate(() => document.getElementById('untitled-probe')?.remove());

// ---------------------------------------------------------------------------
// 3) alert-dialog, titled path. The role assertion is this finding's headline
// question: if the platform reports `dialog`, the urgency is lost AND the user
// is told they can dismiss it with Escape, which alert-dialog blocks by design.
// ---------------------------------------------------------------------------
await page.goto(BASE + '/ui/alert-dialog', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('ui-alert-dialog-trigger button')]
    .find((b) => /delete account/i.test(b.textContent || ''));
  btn?.click();
});
await page.waitForTimeout(700);

const ALERT_PANEL = 'dialog[data-slot="alert-dialog-native"][open] [data-slot="alert-dialog-content"]';
{
  const chain = await axChain(ALERT_PANEL);
  if (!chain) {
    chainMissing('alert-dialog exposes exactly one dialog-family node', ALERT_PANEL);
  } else {
    const dlgs = dialogNodesIn(chain);
    notes.push('alert-dialog: ' + dlgs.length + ' dialog-family node(s), roles=['
      + dlgs.map((n) => n.role?.value).join(', ') + '], name='
      + JSON.stringify(dlgs[0]?.name?.value ?? null));
    results.push(['alert-dialog exposes exactly one dialog-family node', dlgs.length === 1]);
    results.push(['alert-dialog is exposed as alertdialog', dlgs[0]?.role?.value === 'alertdialog']);
    results.push(['alert-dialog takes its name from the title', dlgs[0]?.name?.value === 'Are you sure?']);
    results.push(['alert-dialog is exposed as modal', propOf(dlgs[0], 'modal') === true]);
  }
}

// Close it by calling hide(), NEVER by pressing Escape: alert-dialog blocks the
// native `cancel` event by design, so Escape does nothing and the next
// navigation would run with a modal still open, which empties the tree.
await page.evaluate(() => document.querySelector('ui-alert-dialog')?.hide?.());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 4) alert-dialog, title-less path.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const host = document.createElement('ui-alert-dialog');
  host.id = 'untitled-alert-probe';
  host.innerHTML = '<ui-alert-dialog-content><p>No title here.</p></ui-alert-dialog-content>';
  document.body.appendChild(host);
});
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('untitled-alert-probe')?.show?.());
await page.waitForTimeout(700);

const UNTITLED_ALERT_PANEL = '#untitled-alert-probe dialog[data-slot="alert-dialog-native"][open] [data-slot="alert-dialog-content"]';
{
  const chain = await axChain(UNTITLED_ALERT_PANEL);
  if (!chain) {
    chainMissing('title-less alert-dialog exposes exactly one dialog-family node', UNTITLED_ALERT_PANEL);
  } else {
    const dlgs = dialogNodesIn(chain);
    notes.push('alert-dialog (title-less): ' + dlgs.length + ' dialog-family node(s), name='
      + JSON.stringify(dlgs[0]?.name?.value ?? null));
    results.push(['title-less alert-dialog exposes exactly one dialog-family node', dlgs.length === 1]);
    results.push(['title-less alert-dialog is exposed as alertdialog', dlgs[0]?.role?.value === 'alertdialog']);
    results.push(['title-less alert-dialog falls back to the generic name', dlgs[0]?.name?.value === 'Alert dialog']);
  }
}
await page.evaluate(() => {
  document.querySelector('#untitled-alert-probe')?.hide?.();
  document.getElementById('untitled-alert-probe')?.remove();
});
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 5) sonner. No dialog open here, per the top-layer note above.
//
// Fire through the served module rather than by matching button text: the
// gallery's own buttons import exactly this path, so it is a dependency the
// gallery already has, while the labels are template-generated strings a copy
// edit can change. Locate each toast by its own text, since the page mounts
// several viewports and the last to connect wins.
// ---------------------------------------------------------------------------
await page.goto(BASE + '/ui/sonner', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

async function probeToast(label, fire, probeId, expectAssertive) {
  await page.evaluate(fire);
  await page.waitForTimeout(700);
  const tagged = await page.evaluate(({ id, text }) => {
    const el = [...document.querySelectorAll('[data-slot="sonner-toast"]')]
      .find((t) => (t.textContent || '').includes(text));
    if (!el) return false;
    el.id = id;
    return true;
  }, { id: probeId, text: label });
  if (!tagged) { results.push([label + ' toast rendered', false]); return; }

  const chain = await axChain('#' + probeId);
  if (!chain) { chainMissing(label + ' toast resolves its live roots', '#' + probeId); return; }
  const lives = liveNodesIn(chain);
  const nearest = lives[0];
  notes.push(label + ' toast: ' + lives.length + ' live root(s), politeness=['
    + lives.map((n) => propOf(n, 'live')).join(', ') + ']');

  if (expectAssertive) {
    // An error toast keeps role="alert" on purpose, so it resolves under TWO
    // roots both before and after the sonner fix. Assert the contract that
    // holds in both worlds, and record the observed count in the note above.
    results.push([label + ' toast has at least one live root', lives.length >= 1]);
    results.push([label + ' toast is assertive at its nearest live root', propOf(nearest, 'live') === 'assertive']);
  } else {
    results.push([label + ' toast resolves under exactly one live root', lives.length === 1]);
    results.push([label + ' toast is polite at that root', propOf(nearest, 'live') === 'polite']);
  }
}

// `duration: 0` disables auto-dismiss. Without it a toast defaults to 4000ms
// and the probe races it: this waits 700ms, tags the node, then issues a full
// DOM.getDocument plus getFullAXTree against a large gallery page, and if that
// budget is ever exceeded the toast is gone, the chain resolves to null, and a
// null chain is a hard FAIL by design rather than a skip. The probe never
// asserts dismissal, so removing the timer costs nothing.
await probeToast(
  'Default toast probe',
  () => import('/modules/ui/components/sonner.ts').then((m) => m.toast('Default toast probe', { duration: 0 })),
  'default-toast-probe',
  false,
);
await probeToast(
  'Error toast probe',
  () => import('/modules/ui/components/sonner.ts').then((m) => m.toast.error('Error toast probe', { duration: 0 })),
  'error-toast-probe',
  true,
);

await browser.close();
teardown();

for (const n of notes) console.log('NOTE: ' + n);
let ok = true;
for (const [name, pass] of results) {
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name);
  if (!pass) { ok = false; fail(name); }
}
if (ok) console.log('a11y-tree e2e: all ' + results.length + ' checks passed');
process.exit(ok ? 0 : 1);
