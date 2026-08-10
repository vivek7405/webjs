import { WebComponent, html } from '@webjsdev/core';

/**
 * The forced-badge element is purely presentational: static markup, no
 * events, no reactive properties, no lifecycle hooks, no signals, no slot,
 * light DOM. Every property of it says display-only, so the framework would
 * elide its module from the browser.
 *
 * The one thing that keeps it on the wire is `static interactive = true`, the
 * explicit author override for interactivity static analysis cannot see. It
 * exists to e2e-pin that override: until now the only coverage stopped at the
 * analyser returning a boolean, and nothing proved the boot script actually
 * keeps the module. The e2e probe asserts the browser downloads THIS module on
 * a run where the unobserved build-stamp element is still not downloaded, so
 * the assertion cannot pass because elision stopped working altogether.
 */
export class ForcedBadge extends WebComponent {
  static interactive = true;

  render() {
    return html`<span
      class="font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground/70"
      >forced badge · ships because its author said so</span
    >`;
  }
}
ForcedBadge.register('forced-badge');
