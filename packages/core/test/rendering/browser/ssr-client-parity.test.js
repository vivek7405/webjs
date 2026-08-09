/**
 * SSR-vs-client render parity guard (issue #184), real browser via WTR.
 *
 * A component's SSR'd HTML must match its first CLIENT render, or hydration
 * diverges (wrong DOM, lost state, console errors). This renders a corpus of
 * components two ways for the SAME inputs:
 *   - server: renderToString(template) (the SSR path, browser-loadable, the
 *     same function fixture() uses)
 *   - client: a FRESH client render (mount the bare element, let the browser
 *     upgrade it and run connectedCallback -> render()), with NO SSR DOM to
 *     adopt, so any server-vs-client divergence actually shows
 * and asserts the rendered content is structurally identical after
 * normalising hydration-only artifacts (the <!--webjs-hydrate--> marker, the
 * data-webjs-prop-* hydration attributes, and incidental whitespace).
 *
 * The counterfactual (a component whose render() is non-deterministic across
 * the two calls) must FAIL the parity check, proving the guard has teeth.
 */
import { html, MARKER } from '../../../src/html.js';
import { css } from '../../../src/css.js';
import { WebComponent, prop } from '../../../src/component.js';
import { signal } from '../../../src/signal.js';
import { renderToString } from '../../../src/render-server.js';

import { assert } from '../../../../../test/browser-assert.js';

/**
 * Strip the artifacts that legitimately differ between the SSR string and the
 * live client DOM (none of which is a render divergence) and collapse
 * whitespace, leaving only the rendered template structure to compare:
 *   - the `<!--webjs-hydrate-->` light-DOM hydration marker (SSR only);
 *   - the client renderer's fine-grained part markers `<!--${MARKER}s/e/0/1...-->`
 *     (client only) that mark the instance and dynamic interpolation points,
 *     derived from the MARKER constant so this stays correct if it changes;
 *   - `data-webjs-prop-*` hydration attributes (SSR only, stripped on connect);
 *   - a shadow component's `<style>` block, which SSR inlines into the DSD
 *     but the client delivers via adoptedStyleSheets (same styling, different
 *     transport, not part of render()'s output).
 */
// Match the client part markers `<!--${MARKER}...-->`, derived from the MARKER
// constant (regex-escaped) so a marker change never silently breaks this guard.
const MARKER_COMMENT_RE = new RegExp(
  '<!--/?' + MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]*-->',
  'g'
);

function normalize(htmlStr) {
  return String(htmlStr)
    .replace(/<!--webjs-hydrate-->/g, '')
    .replace(MARKER_COMMENT_RE, '')
    .replace(/\s+data-webjs-prop-[a-z0-9-]+="[^"]*"/g, '')
    // data-wj-slot-owner is an SSR-only hydration carrier for template
    // ownership (#1023); the client render uses a symbol, not the attribute.
    .replace(/\s+data-wj-slot-owner="[^"]*"/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    // Boolean/empty attributes serialise as bare `attr` in the SSR string but
    // `attr=""` in the live DOM. Same attribute, different serialisation.
    .replace(/=""/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the shadow-root inner HTML out of an SSR'd DSD template. */
function ssrShadowInner(ssr) {
  const m = ssr.match(/<template shadowrootmode="open">([\s\S]*?)<\/template>/);
  return m ? m[1] : null;
}

/** Pull a light component's inner HTML out of its SSR'd outer markup. */
function ssrLightInner(ssr, tag) {
  const m = ssr.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*)</${tag}>`));
  return m ? m[1] : ssr;
}

/**
 * The set of reflected/host attribute names on the SSR'd opening tag, minus
 * the framework's own hydration artifacts (`data-webjs-prop-*`). Used to
 * assert that a reflect:true property surfaces identically on the SSR opening
 * tag and the live client element (the inner-HTML helpers above deliberately
 * skip the opening tag).
 */
function ssrHostAttrNames(ssr, tag) {
  const m = ssr.match(new RegExp(`<${tag}((?:"[^"]*"|'[^']*'|[^>])*)>`));
  if (!m) return [];
  return [...m[1].matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=|\s|$)/g)]
    .map((x) => x[1].toLowerCase())
    .filter((n) => !n.startsWith('data-webjs-prop-'));
}

let host;
function freshContainer() {
  if (host) host.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

/** Mount an element fresh on the client and wait for its first render. */
async function clientMount(el) {
  const c = freshContainer();
  c.appendChild(el);
  if (el.updateComplete) await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

suite('SSR vs client render parity (#184)', () => {

  test('light-DOM component: SSR inner equals first client render', async () => {
    class P1 extends WebComponent {
      render() { return html`<p class="greet">hello <strong>world</strong></p>`; }
    }
    P1.register('parity-light-simple');
    const ssr = normalize(ssrLightInner(await renderToString(html`<parity-light-simple></parity-light-simple>`), 'parity-light-simple'));
    const el = await clientMount(document.createElement('parity-light-simple'));
    const client = normalize(el.innerHTML);
    assert.equal(client, ssr, `light parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.length > 0, 'non-empty render');
  });

  test('light-DOM with attribute-backed prop: parity reflects the prop', async () => {
    class P2 extends WebComponent({ label: String }) {
      constructor() { super(); this.label = ''; }
      render() { return html`<span>label is ${this.label}</span>`; }
    }
    P2.register('parity-light-prop');
    const ssr = normalize(ssrLightInner(await renderToString(html`<parity-light-prop label="alpha"></parity-light-prop>`), 'parity-light-prop'));
    const el = document.createElement('parity-light-prop');
    el.setAttribute('label', 'alpha');
    await clientMount(el);
    const client = normalize(el.innerHTML);
    assert.equal(client, ssr, `prop parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.includes('alpha'), 'prop value rendered');
  });

  test('shadow-DOM component with styles: SSR DSD equals client shadowRoot', async () => {
    class P3 extends WebComponent {
      static shadow = true;
      static styles = css`p { color: red; }`;
      render() { return html`<p>shadowed</p>`; }
    }
    P3.register('parity-shadow');
    const ssr = normalize(ssrShadowInner(await renderToString(html`<parity-shadow></parity-shadow>`)));
    const el = await clientMount(document.createElement('parity-shadow'));
    const client = normalize(el.shadowRoot.innerHTML);
    assert.equal(client, ssr, `shadow parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.includes('shadowed'), 'shadow content rendered');
  });

  test('light-DOM with a slot: projected content matches server and client', async () => {
    class P4 extends WebComponent {
      render() { return html`<div class="wrap"><slot></slot></div>`; }
    }
    P4.register('parity-slot');
    const ssr = normalize(ssrLightInner(await renderToString(html`<parity-slot><b>kid</b></parity-slot>`), 'parity-slot'));
    const el = document.createElement('parity-slot');
    el.innerHTML = '<b>kid</b>';
    await clientMount(el);
    await new Promise((r) => setTimeout(r, 0));
    const client = normalize(el.innerHTML);
    assert.equal(client, ssr, `slot parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.includes('kid'), 'projected child present');
  });

  test('.prop round-trip: rich value renders identically server and client', async () => {
    class P5 extends WebComponent({ data: Object }) {
      constructor() { super(); this.data = null; }
      render() { return html`<ul>${(this.data?.items || []).map((i) => html`<li>${i}</li>`)}</ul>`; }
    }
    P5.register('parity-prop-rich');
    const value = { items: ['a', 'b', 'c'] };
    // SSR encodes the rich .prop to a data-webjs-prop-* wire attribute.
    const ssrFull = await renderToString(html`<parity-prop-rich .data=${value}></parity-prop-rich>`);
    assert.ok(/data-webjs-prop-data=/.test(ssrFull), 'SSR must encode the rich prop to the wire attribute');
    const ssr = normalize(ssrLightInner(ssrFull, 'parity-prop-rich'));
    // Hydrate the client FROM the SSR markup so connectedCallback decodes the
    // wire attribute back into the live property (the actual round-trip),
    // rather than assigning .data directly and skipping the serializer.
    const c = freshContainer();
    c.innerHTML = ssrFull;
    const el = c.firstElementChild;
    if (el.updateComplete) await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    const client = normalize(el.innerHTML);
    assert.equal(client, ssr, `rich-prop parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.includes('<li>a</li>'), 'rich prop rendered');
    assert.ok(el.data && el.data.items && el.data.items[0] === 'a',
      'client must decode the wire prop attribute back into the live .data property');
  });

  test('signal-backed component: SSR equals first client render', async () => {
    const count = signal(7);
    class P6 extends WebComponent {
      render() { return html`<output>${count.get()}</output>`; }
    }
    P6.register('parity-signal');
    const ssr = normalize(ssrLightInner(await renderToString(html`<parity-signal></parity-signal>`), 'parity-signal'));
    const el = await clientMount(document.createElement('parity-signal'));
    const client = normalize(el.innerHTML);
    assert.equal(client, ssr, `signal parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.includes('7'), 'signal value rendered');
  });

  test('willUpdate-derived state: SSR equals first client render (#217)', async () => {
    // willUpdate runs on BOTH sides now: the server runs it before render in
    // the SSR walker, the client runs it in the normal update cycle. So a
    // value derived in willUpdate and read in render must be identical server
    // and client. Before #217 the SSR side skipped willUpdate, so the server
    // emitted the constructor placeholder while the client emitted the
    // derived value, a hydration divergence this case now guards against.
    class P8 extends WebComponent({ count: Number }) {
      constructor() { super(); this.count = 0; this.derived = 'placeholder'; }
      willUpdate() { this.derived = `derived-${this.count}`; }
      render() { return html`<output>${this.derived}</output>`; }
    }
    P8.register('parity-willupdate');
    const ssr = normalize(ssrLightInner(await renderToString(html`<parity-willupdate count="3"></parity-willupdate>`), 'parity-willupdate'));
    const el = document.createElement('parity-willupdate');
    el.setAttribute('count', '3');
    await clientMount(el);
    const client = normalize(el.innerHTML);
    assert.equal(client, ssr, `willUpdate parity mismatch\nSSR:    ${ssr}\nCLIENT: ${client}`);
    assert.ok(ssr.includes('derived-3'), 'SSR emitted the willUpdate-derived value, not the constructor placeholder');
  });

  test('reflect:true constructor default: same attribute on the SSR tag and a fresh client element (#217)', async () => {
    // SSR reflects reflect:true props before render, and the client reflects
    // them on its first connected render, so a server-rendered element and a
    // freshly-created one agree on the opening-tag attribute. Before the
    // client-side fix, SSR emitted level="4" while a fresh client mount had
    // no attribute, an SSR-vs-client divergence.
    class P9 extends WebComponent({ level: prop(Number, { reflect: true }) }) {
      constructor() { super(); this.level = 4; }
      render() { return html`<p>L${this.level}</p>`; }
    }
    P9.register('parity-reflect');
    const ssrFull = await renderToString(html`<parity-reflect></parity-reflect>`);
    assert.ok(/<parity-reflect[^>]*\blevel="4"/.test(ssrFull), 'SSR reflected the constructor default to an attribute');
    const ssrAttrs = ssrHostAttrNames(ssrFull, 'parity-reflect');

    const el = await clientMount(document.createElement('parity-reflect'));
    assert.equal(el.getAttribute('level'), '4', 'fresh client element reflects the same attribute');
    const clientAttrs = [...el.attributes].map((a) => a.name.toLowerCase()).filter((n) => !n.startsWith('data-webjs-prop-')).sort();
    assert.equal(JSON.stringify(clientAttrs), JSON.stringify(ssrAttrs.sort()), `host attribute parity mismatch\nSSR:    ${ssrAttrs}\nCLIENT: ${clientAttrs}`);

    // inner parity holds too
    const ssrInner = normalize(ssrLightInner(ssrFull, 'parity-reflect'));
    assert.equal(normalize(el.innerHTML), ssrInner, 'inner render parity');
  });

  test('compound component via closest(): client first paint marks the active item (#220)', async () => {
    // A child derives its active state by reading the parent through
    // closest(). This asserts the CLIENT first render (real DOM, real
    // closest()) marks the matching item active and the others inactive.
    // The SERVER side of the same components is pinned in the Node test
    // packages/core/test/rendering/ssr-closest.test.js, where the server
    // element shim resolves the parent via the SSR ancestor chain and
    // produces the identical active/inactive state. Together the two pin
    // SSR-vs-client parity for the compound pattern: the first paint a user
    // sees before hydration equals the first render after it, so the active
    // tab/item never flashes wrong. (renderToString cannot stand in for the
    // server here when run IN the browser: its instances are detached real
    // HTMLElements whose native closest() returns null, which is exactly why
    // the server path uses the ancestor-chain shim instead.)
    class ParityCxGroup extends WebComponent({ value: String }) {
      constructor() { super(); this.value = ''; }
      render() { return html`<div data-group><slot></slot></div>`; }
    }
    ParityCxGroup.register('parityc-group');

    class ParityCxItem extends WebComponent({ value: String }) {
      constructor() { super(); this.value = ''; }
      render() {
        const group = typeof this.closest === 'function' ? this.closest('parityc-group') : null;
        const active = !!group && group.value === this.value && this.value !== '';
        this.dataset.state = active ? 'active' : 'inactive';
        this.ariaPressed = String(active);
        return html`<button>${this.value}</button>`;
      }
    }
    ParityCxItem.register('parityc-item');

    // Build the compound tree fresh on the client and let the browser upgrade
    // + render it (real closest() against the real DOM), with no SSR DOM.
    const c = freshContainer();
    const group = document.createElement('parityc-group');
    group.setAttribute('value', 'b');
    const itemA = document.createElement('parityc-item'); itemA.setAttribute('value', 'a');
    const itemB = document.createElement('parityc-item'); itemB.setAttribute('value', 'b');
    group.append(itemA, itemB);
    c.appendChild(group);
    if (group.updateComplete) await group.updateComplete;
    if (itemA.updateComplete) await itemA.updateComplete;
    if (itemB.updateComplete) await itemB.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    // The matching item (value="b") is active; the other is inactive. These
    // are the SAME verdicts the Node SSR test asserts for the server paint.
    assert.equal(itemB.getAttribute('data-state'), 'active', 'client marks the matching item active');
    assert.equal(itemA.getAttribute('data-state'), 'inactive', 'client marks the non-matching item inactive');
    assert.equal(itemB.getAttribute('aria-pressed'), 'true', 'client active item is aria-pressed');
    assert.equal(itemA.getAttribute('aria-pressed'), 'false', 'client inactive item is not pressed');
  });

  test('counterfactual: a non-deterministic render FAILS the parity check', async () => {
    // render() returns a different value on each call. The SSR call and the
    // fresh client render therefore diverge, which is exactly the
    // hydration-mismatch bug this guard exists to catch. Assert the parity
    // comparison detects the difference.
    let n = 0;
    class P7 extends WebComponent {
      render() { return html`<p>${++n}</p>`; }
    }
    P7.register('parity-nondeterministic');
    const ssr = normalize(ssrLightInner(await renderToString(html`<parity-nondeterministic></parity-nondeterministic>`), 'parity-nondeterministic'));
    const el = await clientMount(document.createElement('parity-nondeterministic'));
    const client = normalize(el.innerHTML);
    assert.notEqual(client, ssr, 'a non-deterministic render must produce a detectable SSR/client divergence');
  });
});

/* ============================================================================
 * Form-action parity table (#1155)
 *
 * The anti-recurrence measure for the form-action guard. Five review rounds
 * each found the client and SSR disagreeing about the same feature in a new
 * way, because each was checked against its own expectations rather than
 * against the other. Here one template drives BOTH renderers and the two
 * outcomes are compared directly, so a divergence is a failing row rather than
 * a review finding.
 *
 * This lives in the BROWSER suite deliberately. `method` / `enctype` /
 * `encoding` are reflected IDL attributes on a form, and linkedom (which the
 * node-side tests run under) implements no reflection at all, so a `.prop` row
 * asserted there would see the attribute absent and pass for the wrong reason.
 * ========================================================================== */

import { setFormActionResolver, FORM_ACTION_ID_KEY, FORM_ACTION_FIELD } from '../../../src/form-action.js';
import { render } from '../../../src/render-client.js';

const ACTION_ID = 'a1b2c3d4e5/submitFeedback';

/** A stand-in for the generated RPC stub, identified on BOTH sides. */
function boundAction() {
  const fn = async () => { const S = 'PARITY_SECRET'; return S; };
  Object.defineProperty(fn, FORM_ACTION_ID_KEY, { value: ACTION_ID });
  return fn;
}

/**
 * A canonical projection of every form in some markup: tag, attributes sorted
 * by name, and the direct-child elements with their own sorted attributes.
 *
 * Sorted because attribute ORDER legitimately differs between the two paths
 * (SSR appends to a string, the client sets properties on an element), and
 * order is not something either renderer promises. Everything that decides how
 * the form submits (its method, enctype, whether an `action` survived, and the
 * identity field) is captured.
 */
function canonicalForms(htmlStr) {
  const t = document.createElement('template');
  t.innerHTML = normalize(htmlStr);
  const attrs = (el) => [...el.attributes]
    .map((a) => `${a.name}="${a.value}"`).sort().join(' ');
  return [...t.content.querySelectorAll('form')]
    .map((f) => `<form ${attrs(f)}>[${[...f.children].map((c) => `${c.localName} ${attrs(c)}`).join(' | ')}]`)
    .join(' && ');
}

/** Render one template both ways; return either the canonical form or the throw. */
async function bothWays(tpl) {
  let ssr = null;
  let ssrErr = null;
  try { ssr = canonicalForms(await renderToString(tpl(), { ssr: true })); }
  catch (e) { ssrErr = String(e.message); }

  const host = document.createElement('div');
  document.body.appendChild(host);
  let client = null;
  let clientErr = null;
  try { render(tpl(), host); client = canonicalForms(host.innerHTML); }
  catch (e) { clientErr = String(e.message); }
  host.remove();

  return { ssr, ssrErr, client, clientErr };
}

suite('SSR/client parity: form actions (#1155)', () => {
  setup(() => { setFormActionResolver((fn) => (fn[FORM_ACTION_ID_KEY] ? ACTION_ID : null)); });
  teardown(() => { setFormActionResolver(() => null); });

  /** Rows both renderers must ACCEPT, ending in the same submitted shape. */
  const ACCEPTS = {
    'bare bound form': () => html`<form action=${boundAction()}><input name="a"></form>`,
    'author method before the hole': () => html`<form method="post" action=${boundAction()}></form>`,
    'author method after the hole': () => html`<form action=${boundAction()} method="post"></form>`,
    'author enctype, urlencoded': () => html`<form action=${boundAction()} enctype="application/x-www-form-urlencoded"></form>`,
    'hole-provided method': () => html`<form action=${boundAction()} method=${'post'}></form>`,
    'quoted hole-provided method': () => html`<form action=${boundAction()} method="${'post'}"></form>`,
    'mixed attribute with NON-EMPTY statics': () => html`<form action=${boundAction()} method="pos${'t'}"></form>`,
    'falsy boolean hole leaves it to the framework': () => html`<form action=${boundAction()} ?method=${false}></form>`,
    'case-folded ACTION still binds': () => html`<form ACTION=${boundAction()}></form>`,
    'a plain url action is an ordinary form': () => html`<form action=${'/legacy'}></form>`,
    'an unbound form keeps its own method': () => html`<form action=${'/search'} method=${'get'}></form>`,
    'two independent bound forms': () => html`<form action=${boundAction()}></form><form action=${boundAction()}></form>`,
    // `encoding` is a legacy IDL alias of `enctype`, so the PROPERTY spelling
    // reaches the enctype attribute while the CONTENT attribute is inert. SSR
    // ignores it; the client folding it in made the same form upload multipart
    // without JS and urlencoded with it.
    'inert encoding= attribute': () => html`<form action=${boundAction()} encoding=${'application/x-www-form-urlencoded'}></form>`,
    'inert encoding= with an unsubmittable value': () => html`<form action=${boundAction()} encoding=${'text/plain'}></form>`,
    'submitter formaction inside bound form': () => html`<form action=${boundAction()}><button formaction=${boundAction()}>Save</button></form>`,
    // #1307: a bound submitter carries its whole submission, so none of these
    // depend on the form around it. Each moved here from a refusal table, and
    // each must render IDENTICALLY on both renderers, which is what proves the
    // two inject the same `formmethod` / `formenctype` pair in the same order.
    'submitter with no form at all': () => html`<button formaction=${boundAction()}>Save</button>`,
    'submitter inside an unbound form': () => html`<form method="post"><button formaction=${boundAction()}>Save</button></form>`,
    'submitter inside a form with no method at all': () => html`<form><button formaction=${boundAction()}>Save</button></form>`,
    'submitter inside a method=get form': () => html`<form method="get"><button formaction=${boundAction()}>Save</button></form>`,
    // The author's own value wins; only the attribute they did NOT supply is
    // injected. Both renderers make that call through `resolveBoundSubmitterAttrs`.
    'bound submitter supplying its own formmethod': () => html`<button formaction=${boundAction()} formmethod="post">Save</button>`,
    'bound submitter supplying its own formenctype': () => html`<button formaction=${boundAction()} formenctype="application/x-www-form-urlencoded">Save</button>`,
    // HOLE-provided, not static. These are the rows that catch a client record
    // which files a submitter's `formmethod` hole under the wrong attribute:
    // SSR reads the emitted start tag and is unaffected, so only a DIFFERENTIAL
    // row sees it. The first spelling shipped broken and threw
    // `formenctype="post"` on hydration for a template SSR renders happily.
    'bound submitter with a HOLE-provided formmethod': () => html`<button formaction=${boundAction()} formmethod=${'post'}>Save</button>`,
    'bound submitter with a HOLE-provided formenctype': () => html`<button formaction=${boundAction()} formenctype=${'application/x-www-form-urlencoded'}>Save</button>`,
    'bound submitter with BOTH provided by holes': () => html`<button formaction=${boundAction()} formmethod=${'post'} formenctype=${'multipart/form-data'}>Save</button>`,
    // The awkward hole KINDS, which resolve through different commit branches
    // than a plain `attr` hole. An `attr-mixed` value is assembled from statics
    // plus values, and a FALSY boolean hole emits nothing at all, so the
    // framework supplies the attribute exactly as if the template were silent.
    // Each is a separate path through `effectiveFormAttr`, and a plain `attr`
    // row does not exercise any of them.
    'bound submitter with an attr-mixed formmethod': () => html`<button formaction=${boundAction()} formmethod="${'po'}${'st'}">Save</button>`,
    'bound submitter with a FALSY boolean formmethod hole': () => html`<button formaction=${boundAction()} ?formmethod=${false}>Save</button>`,
    'bound submitter with a FALSY boolean formenctype hole': () => html`<button formaction=${boundAction()} ?formenctype=${false}>Save</button>`,
    // #1307 reverses #1207's Part B: a PLAIN button's own override is a legal
    // native instruction, so both renderers leave it exactly as written.
    'plain submitter formmethod=get inside a bound form': () => html`<form action=${boundAction()}><button formmethod="get">Save</button></form>`,
    'plain submitter formenctype=text/plain inside a bound form': () => html`<form action=${boundAction()}><button formenctype="text/plain">Save</button></form>`,
  };

  for (const [name, tpl] of Object.entries(ACCEPTS)) {
    test(`accepts identically: ${name}`, async () => {
      const r = await bothWays(tpl);
      assert.equal(r.ssrErr, null, `SSR must accept, threw: ${r.ssrErr}`);
      assert.equal(r.clientErr, null, `client must accept, threw: ${r.clientErr}`);
      assert.equal(r.client, r.ssr, `client and SSR must agree for: ${name}`);
      assert.ok(!/PARITY_SECRET/.test(String(r.ssr)), 'no action source in the markup');
    });
  }

  /** Rows both renderers must REFUSE, for the same stated reason. */
  const REFUSES = {
    'method=get': [() => html`<form method="get" action=${boundAction()}></form>`, /cannot work/],
    'hole-provided method=get after the hole': [() => html`<form action=${boundAction()} method=${'get'}></form>`, /cannot work/],
    'quoted hole-provided method=get': [() => html`<form action=${boundAction()} method="${'get'}"></form>`, /cannot work/],
    'null method hole renders an empty value': [() => html`<form action=${boundAction()} method=${null}></form>`, /cannot work/],
    'truthy boolean hole renders an empty value': [() => html`<form action=${boundAction()} ?enctype=${true}></form>`, /cannot work/],
    'unparseable enctype': [() => html`<form action=${boundAction()} enctype="text/plain"></form>`, /cannot work/],
    'quoted action hole is a stringify': [() => html`<form action="${boundAction()}"></form>`, /interpolated into/],
    'array-wrapped action': [() => html`<form action=${[boundAction()]}></form>`, /interpolated into/],
    'action off a form': [() => html`<div action=${boundAction()}></div>`, /interpolated into/],
    'submitter that is not a submit control': [
      () => html`<form action=${boundAction()}><button type="button" formaction=${boundAction()}></button></form>`,
      /submitter control/,
    ],
    'submitter carrying its own name': [
      () => html`<form action=${boundAction()}><button name="intent" formaction=${boundAction()}></button></form>`,
      /already carries a "name" attribute/,
    ],
    // #1307: same-element contradictions on a BOUND submitter. These replace
    // #1207's Part B rows, which asked about the button's NEIGHBOUR and are now
    // in ACCEPTS. Here the author bound an action to this very button and then
    // told the same button to submit in a way that action could never read.
    'unparseable enctype on a BOUND submitter': [
      () => html`<button formaction=${boundAction()} formenctype="text/plain"></button>`,
      /formenctype=/,
    ],
    'non-POST method on a BOUND submitter': [
      () => html`<button formaction=${boundAction()} formmethod="get"></button>`,
      /formmethod=/,
    ],
    'dialog method on a BOUND submitter': [
      () => html`<button formaction=${boundAction()} formmethod="dialog"></button>`,
      /formmethod="dialog"/,
    ],
    // A TRUTHY boolean hole emits `formmethod=""`, an empty enumerated value
    // that cannot submit, so it must refuse rather than be treated as absent
    // and quietly supplied. This is the submitter twin of the form-level
    // `?enctype=${true}` row above.
    'truthy boolean formmethod hole on a BOUND submitter': [
      () => html`<button formaction=${boundAction()} ?formmethod=${true}></button>`,
      /cannot work/,
    ],
    'padded formmethod on a BOUND submitter': [
      () => html`<button formaction=${boundAction()} formmethod=${' post '}></button>`,
      /cannot work/,
    ],
    'prop binding on a BOUND submitter': [
      () => html`<button formaction=${boundAction()} .formMethod=${'get'}></button>`,
      /reflected IDL attribute/,
    ],
    'a function that is not an action': [() => html`<form action=${async () => {}}></form>`, /is not a server action/],
    'prop binding on a bound form': [() => html`<form action=${boundAction()} .method=${'get'}></form>`, /also binds \./],
    'two action holes': [() => html`<form action=${boundAction()} action=${'/legacy'}></form>`, /two action=/],
    // Written the OTHER way round: the client used to record only the first
    // action hole, so this took the release path and shipped a form posting to
    // /legacy with no identity, while SSR refused the same template.
    'two action holes, bound one second': [() => html`<form action=${'/legacy'} action=${boundAction()}></form>`, /two action=/],
    // A static `action` survives SSR (the hole drops only its own) and the
    // client's reconcile removes it, so the no-JS and JS submissions target
    // different urls.
    'static action alongside the hole': [() => html`<form action="/legacy" action=${boundAction()}></form>`, /plain action="\.\.\." attribute/],
    // Enumerated attributes are matched against exact keywords with no
    // whitespace stripping, so a padded value falls to the invalid-value
    // default and submits as a GET with no body.
    'padded method': [() => html`<form action=${boundAction()} method=${' post '}></form>`, /cannot work/],
    'padded enctype': [() => html`<form action=${boundAction()} enctype=${' multipart/form-data '}></form>`, /cannot work/],
  };

  for (const [name, [tpl, pattern]] of Object.entries(REFUSES)) {
    test(`refuses identically: ${name}`, async () => {
      const r = await bothWays(tpl);
      assert.ok(r.ssrErr, `SSR must refuse: ${name}`);
      assert.ok(r.clientErr, `client must refuse: ${name}`);
      assert.ok(pattern.test(r.ssrErr), `SSR reason (${r.ssrErr})`);
      assert.ok(pattern.test(r.clientErr), `client reason (${r.clientErr})`);
      assert.ok(!/PARITY_SECRET/.test(r.ssrErr + r.clientErr), 'a refusal never quotes the source');
    });
  }

  /**
   * There is deliberately NO third table here any more.
   *
   * #1207 had one, holding a single row: a `formaction=${fn}` submitter with no
   * enclosing form. "Is my enclosing form bound" was a question SSR always
   * answered and the client sometimes could not, because the client reconciles
   * a template whose root may be a DocumentFragment not yet in the tree, where a
   * stray button and a list row about to be inserted into a bound form look
   * identical. So SSR refused and the client deferred, and that asymmetry was
   * documented here as permanent.
   *
   * #1307 removed the question rather than the asymmetry. A bound submitter now
   * carries its own `formmethod` and `formenctype`, so no renderer needs to know
   * what encloses it, and the row moved to ACCEPTS where both renderers must now
   * produce identical bytes for it.
   *
   * Keep this table absent. A new "SSR refuses, client defers" entry is a signal
   * that a cross-element rule has crept back in, which is exactly the shape both
   * issues concluded cannot be enforced honestly.
   */

  test('the identity field is submitted, which is what all of this is for', () => {
    // The end state, read the way a browser reads it: `new FormData(form)` is
    // exactly what a native submission serialises.
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(html`<form action=${boundAction()}><input name="email" value="a@b.com"></form>`, host);
    const fd = new FormData(host.querySelector('form'));
    assert.equal(fd.get(FORM_ACTION_FIELD), ACTION_ID, 'the identity rides the submission');
    assert.equal(fd.get('email'), 'a@b.com');
    host.remove();
  });

  test('counterfactual: the table can tell the two renderers apart', () => {
    // A guard that compared nothing would pass every row above. Prove the
    // canonical projection actually distinguishes two different forms.
    const a = canonicalForms('<form method="post"><input name="x"></form>');
    const b = canonicalForms('<form method="get"><input name="x"></form>');
    assert.notEqual(a, b, 'differing method must be visible to the comparison');
  });
});

// ---------------------------------------------------------------------------
// The SSR and client attribute readers see the same attribute SET (#1341).
//
// The suites above compare RENDER output for inputs both readers agree on.
// These four cases are the ones they did NOT agree on: for each, one reader
// consumed an attribute the other never saw, so the SSR'd first paint held one
// value and the upgraded element held another with nothing erroring.
//
// Each test goes through a REAL element upgrade rather than a hand-called
// `attributeChangedCallback`, because the divergence lives on the platform's
// own path: the HTML parser lowercases every attribute name and decodes every
// character reference before any reader is called, and `observedAttributes`
// filters which names are delivered at all. A hand-called reader reproduces
// none of that. The same markup then goes through `renderToString` and the two
// values are compared, so a future change that moves one side without the other
// fails here.

/** Mount source markup, wait for the upgrade, and return the live element. */
async function upgrade(tag, markup, keep) {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  keep.push(host);
  const el = host.firstElementChild;
  await customElements.whenDefined(tag);
  await el.updateComplete;
  return el;
}

suite('the SSR and client attribute readers see the same attribute set (#1341)', () => {
  const mounted = [];
  teardown(() => {
    for (const host of mounted.splice(0)) host.remove();
  });

  class EntEl extends WebComponent({ cfg: prop(Object) }) {
    constructor() { super(); this.cfg = null; }
    render() { return html`<i>val=${JSON.stringify(this.cfg)}</i>`; }
  }
  EntEl.register('parity-ent-el');

  class StateObj extends WebComponent({ cfg: prop(Object, { state: true }) }) {
    constructor() { super(); this.cfg = { fromCtor: true }; }
    render() { return html`<i>val=${JSON.stringify(this.cfg)}</i>`; }
  }
  StateObj.register('parity-state-obj');

  class CamelEl extends WebComponent({ cfgData: prop(String) }) {
    constructor() { super(); this.cfgData = 'CTOR'; }
    render() { return html`<i>val=${String(this.cfgData)}</i>`; }
  }
  CamelEl.register('parity-camel-el');

  class StrEl extends WebComponent({ s: prop(String) }) {
    constructor() { super(); this.s = ''; }
    render() { return html`<i>val=${String(this.s)}</i>`; }
  }
  StrEl.register('parity-str-el');

  test('an entity-encoded JSON attribute parses to the same object on both sides', async () => {
    // The browser decodes `&#123;&quot;a&quot;:1&#125;` before the reader sees
    // it, so it always parsed. SSR reversed three entities and got `null`.
    const markup = '<parity-ent-el cfg="&#123;&quot;a&quot;:1&#125;"></parity-ent-el>';
    const el = await upgrade('parity-ent-el', markup, mounted);

    assert.deepEqual(el.cfg, { a: 1 }, 'the platform decodes this before any reader runs');
    const ssr = await renderToString(html([markup]));
    assert.ok(ssr.includes('val={"a":1}'), `the SSR reader disagreed with the client: ${ssr}`);
  });

  test('a state:true attribute leaves the constructor value on both sides', async () => {
    // `observedAttributes` excludes state props, so the browser never calls the
    // reader for this name at all. SSR had no such filter and read it.
    const markup = '<parity-state-obj cfg="oops"></parity-state-obj>';
    const el = await upgrade('parity-state-obj', markup, mounted);

    assert.ok(
      !StateObj.observedAttributes.includes('cfg'),
      'the platform fact this rests on: a state prop is not observed',
    );
    assert.deepEqual(el.cfg, { fromCtor: true }, 'the browser never delivered the attribute');
    const ssr = await renderToString(html([markup]));
    assert.ok(ssr.includes('val={"fromCtor":true}'), `the SSR reader disagreed with the client: ${ssr}`);
  });

  test('a camelCase attribute name resolves to nothing on both sides', async () => {
    // The parser lowercases the name, so it can never match `cfg-data` in
    // `observedAttributes`. SSR matched the SOURCE case and did read it.
    const markup = '<parity-camel-el cfgData="oops"></parity-camel-el>';
    const el = await upgrade('parity-camel-el', markup, mounted);

    const names = el.getAttributeNames();
    assert.ok(names.includes('cfgdata'), `the parser lowercased the name: ${names.join(', ')}`);
    assert.ok(!names.includes('cfgData'), `the source case did not survive parsing: ${names.join(', ')}`);
    assert.equal(el.cfgData, 'CTOR', 'the browser resolved the lowercased name to nothing');

    const ssr = await renderToString(html([markup]));
    assert.ok(ssr.includes('val=CTOR'), `the SSR reader disagreed with the client: ${ssr}`);
  });

  test('a named character reference in a String attribute decodes on both sides', async () => {
    // The most reachable case of the four: every hand-written entity in a plain
    // string attribute hit it, because SSR decoded only on the JSON branch.
    const markup = '<parity-str-el s="a&hellip;b"></parity-str-el>';
    const el = await upgrade('parity-str-el', markup, mounted);

    assert.equal(el.getAttribute('s'), 'a…b', 'the platform decodes before any reader runs');
    assert.equal(el.s, 'a…b');

    const ssr = await renderToString(html([markup]));
    assert.ok(ssr.includes('val=a…b'), `the SSR reader disagreed with the client: ${ssr}`);
  });

  test('a legacy semicolon-less reference decodes on both sides, with the carve-out', async () => {
    // Not a non-goal: a browser really does decode `&nbsp` in an attribute
    // value, and the rule that governs it is a one-character lookahead, so it
    // is reproducible. The three literal rows below are what keeps the rule a
    // rule rather than "decode a legacy name wherever you see one", though they
    // do not all get there the same way: `&nbsp=x` is the lookahead, while
    // `&nbspx` and `&notin` are simply not legacy names once the whole
    // alphanumeric run is taken. A browser reaches the same answers by longest
    // match plus the same lookahead, which is the agreement being pinned.
    for (const [source, expected] of [
      ['&nbsp', ' '],
      ['&copy', '©'],
      ['&nbspx', '&nbspx'],
      ['&nbsp=x', '&nbsp=x'],
      ['&notin', '&notin'],
    ]) {
      const markup = `<parity-str-el s="${source}"></parity-str-el>`;
      const el = await upgrade('parity-str-el', markup, mounted);
      assert.equal(el.getAttribute('s'), expected, `the platform's own answer for ${source}`);

      const out = await renderToString(html([markup]));
      const m = /val=([^<]*)</.exec(out);
      const rendered = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      assert.equal(rendered, expected, `the SSR reader disagreed with the client for ${source}`);
    }
  });

  test('a name colliding with Object.prototype is literal on both sides', async () => {
    // These are not named references, so a browser leaves them alone. The SSR
    // decoder read its table by indexing an object literal, which resolves
    // through `Object.prototype`, so each of these returned a function and threw
    // out of the decoder instead. Measured here rather than reasoned about,
    // because every other entity claim in this suite is measured.
    for (const name of [
      'constructor', 'toString', 'valueOf', 'hasOwnProperty',
      'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__',
    ]) {
      const markup = `<parity-str-el s="&${name};"></parity-str-el>`;
      const el = await upgrade('parity-str-el', markup, mounted);
      assert.equal(el.getAttribute('s'), `&${name};`, `the platform's own answer for &${name};`);

      const out = await renderToString(html([markup]));
      assert.ok(!out.includes('data-webjs-error'), `the SSR decoder threw on &${name};: ${out}`);
      const m = /val=([^<]*)</.exec(out);
      const rendered = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      assert.equal(rendered, `&${name};`, `the SSR reader disagreed with the client for &${name};`);
    }
  });

  test('a custom-attribute prop answers to its declared name and nothing else', async () => {
    // `observedAttributes` holds the DECLARED attribute alone, so a browser
    // never delivers the property name to any reader. A `props[name]` fallback
    // in the resolver used to make SSR read it anyway, which SSR'd `true` and
    // upgraded to the constructor value.
    class CustomAttr extends WebComponent({ open: prop(Boolean, { attribute: 'is-open' }) }) {
      constructor() { super(); this.open = false; }
      render() { return html`<i>open=${String(this.open)}</i>`; }
    }
    CustomAttr.register('parity-custom-attr');

    assert.deepEqual(CustomAttr.observedAttributes, ['is-open'], 'the platform fact this rests on');

    const byProp = await upgrade('parity-custom-attr', '<parity-custom-attr open></parity-custom-attr>', mounted);
    assert.equal(byProp.open, false, 'the browser never delivered the property name');
    const ssrByProp = await renderToString(html(['<parity-custom-attr open></parity-custom-attr>']));
    assert.ok(ssrByProp.includes('open=false'), `the SSR reader disagreed with the client: ${ssrByProp}`);

    const byAttr = await upgrade('parity-custom-attr', '<parity-custom-attr is-open></parity-custom-attr>', mounted);
    assert.equal(byAttr.open, true, 'the declared attribute must still resolve');
    const ssrByAttr = await renderToString(html(['<parity-custom-attr is-open></parity-custom-attr>']));
    assert.ok(ssrByAttr.includes('open=true'), `the declared attribute stopped resolving at SSR: ${ssrByAttr}`);
  });

  test('and the SSR instance getAttribute() returns the same decoded string', async () => {
    // `seedServerAttrs` shares the decoder, so a `this.getAttribute(name)` read
    // during SSR returns what the browser's own getAttribute returns above.
    class SeedProbe extends WebComponent({ s: prop(String) }) {
      constructor() { super(); this.s = ''; }
      render() { return html`<i>attr=${String(this.getAttribute('s'))}</i>`; }
    }
    SeedProbe.register('parity-seed-probe');

    const markup = '<parity-seed-probe s="a&hellip;b"></parity-seed-probe>';
    const el = await upgrade('parity-seed-probe', markup, mounted);
    assert.equal(el.getAttribute('s'), 'a…b');

    const ssr = await renderToString(html([markup]));
    assert.ok(ssr.includes('attr=a…b'), `the SSR element shim disagreed with the browser: ${ssr}`);
  });
});
