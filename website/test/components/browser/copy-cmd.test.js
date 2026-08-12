/**
 * Browser tests for the <copy-cmd> element covering click-to-copy and
 * the icon flip.
 *
 * The component is light DOM and progressively enhanced: the slotted
 * command text is the click target, clicking writes the trimmed text to
 * the clipboard, and the copy icon flips to a checkmark for ~1.5s.
 *
 * navigator.clipboard.writeText is stubbed so the test is deterministic
 * regardless of the headless browser's clipboard permission (the real
 * component swallows a rejected write, so without the stub the flip would
 * never happen and there would be nothing to assert).
 */
import '#components/copy-cmd.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

suite('copy-cmd', () => {
  let written;
  let restoreClipboard;
  let gtagCalls;
  let restoreGtag;

  const stubGtag = () => {
    gtagCalls = [];
    const had = 'gtag' in window;
    const prev = window.gtag;
    window.gtag = (...args) => { gtagCalls.push(args); };
    restoreGtag = () => { if (had) window.gtag = prev; else delete window.gtag; };
  };

  const stubClipboard = () => {
    written = null;
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
      || Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { written = t; } },
    });
    restoreClipboard = () => {
      delete navigator.clipboard;
      if (desc) Object.defineProperty(navigator, 'clipboard', desc);
    };
  };

  const mount = async (text) => {
    const el = document.createElement('copy-cmd');
    el.textContent = text;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  };

  setup(() => { stubClipboard(); stubGtag(); });
  teardown(() => { restoreClipboard && restoreClipboard(); restoreGtag && restoreGtag(); });

  test('renders the slotted command and a copy affordance', async () => {
    const el = await mount('npm create webjs@latest my-app');
    const textEl = el.querySelector('[data-copy-text]');
    assert.ok(textEl, 'a [data-copy-text] click target is rendered');
    assert.ok(
      textEl.textContent.includes('npm create webjs@latest my-app'),
      'the slotted command text is projected into the click target',
    );
    assert.ok(el.querySelector('button'), 'a copy button is rendered');
    assert.ok(
      el.querySelector('button').className.includes('opacity-100'),
      'the copy button is always visible (not hover-only)',
    );
    assert.ok(
      !el.querySelector('button').className.includes('opacity-0'),
      'the idle button is not hover-gated (no opacity-0)',
    );
    assert.equal(
      el.querySelector('[data-copy-text]').getAttribute('aria-label'),
      null,
      'no aria-label hides the command; the command text is the accessible name',
    );
    // Pre-copy the button shows the copy (clipboard) icon, not the check.
    assert.ok(el.querySelector('button rect'), 'copy icon is shown initially');
    assert.equal(el.querySelector('button polyline'), null, 'no checkmark initially');
    document.body.removeChild(el);
  });

  test('describes the copy action via a title without hiding the command', async () => {
    const el = await mount('npm create webjs@latest my-app');
    const target = el.querySelector('[data-copy-text]');
    // The command stays the accessible NAME (slotted text, no aria-label)...
    assert.equal(target.getAttribute('aria-label'), null, 'no aria-label overrides the command name');
    assert.ok(target.textContent.includes('npm create webjs@latest my-app'), 'the command is the accessible name');
    // ...and the title supplies the copy ACTION as the accessible description
    // (plus a native hover tooltip). A title needs no id, which is the point:
    // the old aria-describedby needed a document-unique id, the only SSR-safe
    // source of one is a module-scope counter, and the counter made every
    // render emit different bytes, killing the page ETag (#1127).
    assert.equal(target.getAttribute('title'), 'Copy command to clipboard',
      'the title describes the copy-to-clipboard action');
    assert.equal(target.getAttribute('aria-describedby'), null,
      'no id-based description reference remains');
    // The description is an attribute, not text, so the target's text is
    // EXACTLY the command: selections and _copy cannot pick up anything else.
    assert.equal(target.textContent.trim(), 'npm create webjs@latest my-app',
      'the click target contains only the command text');
    document.body.removeChild(el);
  });

  test('renders no generated ids, so repeated renders are byte-identical', async () => {
    // The regression guard for #1127. Any per-render-varying value in the
    // component's output (a counter, a timestamp, a random id) changes the
    // page's bytes between renders, which changes its ETag, which means an
    // If-None-Match can never match and a 304 is impossible. Assert the
    // rendered markup of two independent instances of the SAME command is
    // identical, which no monotonic id scheme can satisfy.
    const a = await mount('npm create webjs@latest my-app');
    const b = await mount('npm create webjs@latest my-app');
    assert.equal(a.innerHTML, b.innerHTML, 'two renders of the same command emit identical markup');
    a.remove(); b.remove();
  });

  test('clicking the command copies the trimmed text and flips to a checkmark', async () => {
    const el = await mount('   npm create webjs@latest my-app   ');
    el.querySelector('[data-copy-text]').click();
    await tick(10);          // let the async _copy + clipboard stub resolve
    await el.updateComplete;  // and the copied-signal re-render commit

    assert.equal(written, 'npm create webjs@latest my-app', 'trimmed text was written to the clipboard');
    assert.ok(el.querySelector('button polyline'), 'icon flipped to the checkmark');
    assert.equal(el.querySelector('button rect'), null, 'copy icon is gone after copy');
    assert.ok(
      el.querySelector('button').className.includes('opacity-100'),
      'the button is made visible (opacity-100) in the copied state',
    );
    assert.equal(
      el.querySelector('[role="status"]').textContent.trim(),
      'Copied',
      'the live region announces "Copied" to assistive tech',
    );
    document.body.removeChild(el);
  });

  test('re-announces "Copied" on a repeat copy within the reset window', async () => {
    const el = await mount('npm create webjs@latest my-app');
    const target = el.querySelector('[data-copy-text]');
    const live = el.querySelector('[role="status"]');
    target.click();
    await tick(10);
    await el.updateComplete;
    const first = live.textContent;
    assert.equal(first.trim(), 'Copied', 'announces Copied on the first copy');
    // Copy again BEFORE the 1.5s reset fires (copied is still true).
    target.click();
    await tick(10);
    await el.updateComplete;
    const second = live.textContent;
    assert.equal(second.trim(), 'Copied', 'still reads Copied on the repeat copy');
    // The text node must differ so an aria-live region re-announces. If the
    // text were a constant 'Copied', this would fail (the counterfactual).
    assert.ok(first !== second, 'the live-region text changes so aria-live re-fires');
    document.body.removeChild(el);
  });

  test('keyboard activation (Enter) copies too', async () => {
    const el = await mount('npm create webjs@latest my-app');
    const target = el.querySelector('[data-copy-text]');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(10);
    await el.updateComplete;
    assert.equal(written, 'npm create webjs@latest my-app', 'Enter triggers a copy');
    assert.ok(el.querySelector('button polyline'), 'icon flipped to the checkmark on Enter');
    document.body.removeChild(el);
  });

  test('keyboard activation (Space) copies too', async () => {
    const el = await mount('npm create webjs@latest my-app');
    const target = el.querySelector('[data-copy-text]');
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    // Space must be preventDefaulted so the page does not scroll on the keypress
    // (the counterfactual the copy/flip assertions alone do not provide).
    assert.ok(ev.defaultPrevented, 'Space is preventDefaulted so the page does not scroll');
    await tick(10);
    await el.updateComplete;
    assert.equal(written, 'npm create webjs@latest my-app', 'Space triggers a copy');
    assert.ok(el.querySelector('button polyline'), 'icon flipped to the checkmark on Space');
    document.body.removeChild(el);
  });

  test('a rejected clipboard write fails silently (no flip, empty live region)', async () => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    const el = await mount('npm create webjs@latest my-app');
    el.querySelector('[data-copy-text]').click();
    await tick(10);
    await el.updateComplete;
    assert.ok(el.querySelector('button rect'), 'copy icon stays (no flip) when the write is rejected');
    assert.equal(el.querySelector('button polyline'), null, 'no checkmark on a rejected write');
    assert.equal(el.querySelector('[role="status"]').textContent.trim(), '', 'the live region stays empty');
    document.body.removeChild(el);
  });

  test('a successful copy fires a gtag copy_command event with the command', async () => {
    const el = await mount('   npm create webjs@latest my-app   ');
    el.querySelector('[data-copy-text]').click();
    await tick(10);
    await el.updateComplete;
    const ev = gtagCalls.find((a) => a[0] === 'event' && a[1] === 'copy_command');
    assert.ok(ev, 'a copy_command event was sent to gtag');
    assert.equal(ev[2].command, 'npm create webjs@latest my-app', 'the trimmed command rides the event');
    document.body.removeChild(el);
  });

  test('a rejected clipboard write fires no gtag event (counterfactual)', async () => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    const el = await mount('npm create webjs@latest my-app');
    el.querySelector('[data-copy-text]').click();
    await tick(10);
    await el.updateComplete;
    assert.equal(
      gtagCalls.filter((a) => a[1] === 'copy_command').length,
      0,
      'no copy_command event when the clipboard write failed',
    );
    document.body.removeChild(el);
  });

  test('a copy with gtag absent is a safe no-op (no throw, still copies)', async () => {
    restoreGtag(); delete window.gtag; restoreGtag = null;
    const el = await mount('npm create webjs@latest my-app');
    // Await the handler DIRECTLY (not a fire-and-forget click): the gtag
    // call now sits outside the clipboard try, so with the `?.` removed an
    // absent gtag makes _copy reject, failing this await. That is the real
    // counterfactual the click-based version could not provide (a throw
    // there was swallowed by the clipboard catch after the copy succeeded).
    let threw = false;
    try { await el._copy(); } catch { threw = true; }
    assert.ok(!threw, '_copy resolves (does not throw) when gtag is absent');
    assert.equal(written, 'npm create webjs@latest my-app', 'the copy still succeeds without gtag');
    await el.updateComplete;
    assert.ok(el.querySelector('button polyline'), 'icon still flips without gtag');
    document.body.removeChild(el);
  });

  test('disconnecting clears the pending auto-reset timer', async () => {
    // After a copy, a 1.5s timer is armed to flip the icon back. Removing the
    // element before it fires must clearTimeout it (disconnectedCallback). Spy
    // on clearTimeout so deleting that cleanup makes this test fail (the
    // counterfactual the firing-path test on its own does not provide).
    const realClear = window.clearTimeout;
    const cleared = [];
    window.clearTimeout = (id) => { cleared.push(id); return realClear(id); };
    try {
      const el = await mount('npm create webjs@latest my-app');
      el.querySelector('[data-copy-text]').click();
      await tick(10);
      await el.updateComplete;          // copied=true, the 1.5s reset timer is armed
      assert.ok(el.querySelector('button polyline'), 'flipped to the checkmark, so a timer is pending');
      const before = cleared.length;
      el.remove();                       // disconnectedCallback must cancel the pending timer
      assert.ok(cleared.length > before, 'disconnecting cleared the pending auto-reset timer');
    } finally {
      window.clearTimeout = realClear;
    }
  });

  suite('inline variant', () => {
    const mountInline = async (text) => {
      const el = document.createElement('copy-cmd');
      el.setAttribute('inline', '');
      el.textContent = text;
      document.body.appendChild(el);
      await el.updateComplete;
      return el;
    };

    test('renders a code chip and NOT the bar button', async () => {
      const el = await mountInline('bun create webjs@latest my-app');
      const target = el.querySelector('[data-copy-text]');
      assert.ok(target, 'a [data-copy-text] click target is rendered');
      assert.equal(target.tagName, 'CODE', 'the inline chip is a <code>, keeping the command semantic');
      // The counterfactual for the whole variant: the bar renders an absolutely
      // positioned <button> and reserves pr-9 for it, and BOTH would wreck a
      // line of prose. If the inline branch is deleted, this fails.
      assert.equal(el.querySelector('button'), null, 'no absolutely positioned bar button inline');
      assert.ok(!target.className.includes('pr-9'), 'no pr-9 button reservation inline');
      assert.ok(target.className.includes('whitespace-nowrap'), 'the chip is one unbreakable unit');
      assert.ok(
        target.textContent.includes('bun create webjs@latest my-app'),
        'the slotted command is projected into the chip',
      );
      el.remove();
    });

    test('clicking the chip copies the command', async () => {
      const el = await mountInline('   bun create webjs@latest my-app   ');
      el.querySelector('[data-copy-text]').click();
      await tick(10);
      await el.updateComplete;
      // The icon lives INSIDE the copy target here, so this also proves the svg
      // contributes no text: an untrimmed or icon-polluted read would not equal
      // the command exactly.
      assert.equal(written, 'bun create webjs@latest my-app', 'the exact command was written to the clipboard');
      assert.ok(el.querySelector('polyline'), 'the inline icon flipped to the checkmark');
      assert.equal(el.querySelector('rect'), null, 'the copy icon is gone after copy');
      assert.equal(
        el.querySelector('[role="status"]').textContent.trim(),
        'Copied',
        'the live region announces to assistive tech inline too',
      );
      el.remove();
    });

    test('keyboard activation copies inline too', async () => {
      const el = await mountInline('bun create webjs@latest my-app');
      const target = el.querySelector('[data-copy-text]');
      assert.equal(target.getAttribute('role'), 'button', 'the chip is exposed as a button');
      assert.equal(target.getAttribute('tabindex'), '0', 'the chip is reachable by keyboard');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await tick(10);
      await el.updateComplete;
      assert.equal(written, 'bun create webjs@latest my-app', 'Enter triggers a copy inline');
      el.remove();
    });

    test('renders no generated ids inline either (ETag guard)', async () => {
      const a = await mountInline('bun create webjs@latest my-app');
      const b = await mountInline('bun create webjs@latest my-app');
      assert.equal(a.innerHTML, b.innerHTML, 'two inline renders of the same command emit identical markup');
      a.remove(); b.remove();
    });
  });

  test('the checkmark resets back to the copy icon', async () => {
    const el = await mount('npm create webjs@latest my-app');
    el.querySelector('[data-copy-text]').click();
    await tick(10);
    await el.updateComplete;
    assert.ok(el.querySelector('button polyline'), 'checkmark shown right after copy');

    await tick(1700);         // the component resets after ~1.5s
    await el.updateComplete;
    assert.ok(el.querySelector('button rect'), 'copy icon is restored after the reset window');
    assert.equal(el.querySelector('button polyline'), null, 'checkmark is gone after the reset window');
    assert.equal(el.querySelector('[role="status"]').textContent.trim(), '', 'the live region clears on reset');
    document.body.removeChild(el);
  });
});
