import { html, type LayoutProps } from '@webjsdev/core';

/**
 * `/script-swap` is the e2e fixture for #1102.
 *
 * The shape that surfaced the bug: a layout emits its progressive-enhancement
 * script as a SIBLING of `${children}` rather than inside it. That makes the
 * script a TOP-LEVEL node of the range the client router swaps when you
 * navigate into this route from outside, and `reactivateScripts` used to look
 * only INSIDE each top-level node (`querySelectorAll` never matches the
 * element it is called on), so the script silently never ran again.
 *
 * Two scripts, one on each side of `${children}`, because the fix has two
 * halves and each needs its own witness:
 *
 *  - the BEFORE script proves a top-level script re-executes at all;
 *  - the AFTER script proves the range walk was not truncated. Reactivating a
 *    top-level script detaches it, so a live `nextSibling` walk would end at
 *    the before-script and never reach anything past `${children}`.
 *
 * Each one bumps a window counter AND writes it into the readout below, so the
 * assertion works from either side. On a soft navigation into this route the
 * readouts arrive freshly imported at 0 and the scripts are what set them.
 */
export default function ScriptSwapLayout({ children }: LayoutProps) {
  return html`
    <section class="mb-8">
      <h1 class="font-serif text-display leading-[1.02] tracking-[-0.035em] font-bold m-0 mb-4">
        Script swap
      </h1>
      <p class="text-lede leading-[1.5] text-muted-foreground max-w-[56ch] m-0 mb-4">
        This layout emits two inline scripts as siblings of its children. Both
        must run again on a soft navigation into this route, not just on a cold
        load.
      </p>
      <dl class="flex gap-8 m-0 text-sm">
        <div>
          <dt class="text-muted-foreground">before children</dt>
          <dd class="m-0 font-bold" id="script-swap-before">0</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">after children</dt>
          <dd class="m-0 font-bold" id="script-swap-after">0</dd>
        </div>
      </dl>
    </section>

    <script>
      (function () {
        window.__wjScriptBefore = (window.__wjScriptBefore || 0) + 1;
        var el = document.getElementById('script-swap-before');
        if (el) el.textContent = String(window.__wjScriptBefore);
      })();
    </script>

    ${children}

    <script>
      (function () {
        window.__wjScriptAfter = (window.__wjScriptAfter || 0) + 1;
        var el = document.getElementById('script-swap-after');
        if (el) el.textContent = String(window.__wjScriptAfter);
      })();
    </script>
  `;
}
