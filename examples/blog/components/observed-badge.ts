import { WebComponent, html } from '@webjsdev/core';

/**
 * The observed-badge element is a purely presentational web component:
 * static markup, no events, no reactive properties, no lifecycle hooks,
 * no signals, no slot. On its own the framework would classify it as
 * display-only and elide its module from the browser.
 *
 * It exists to e2e-pin the cross-module-registration fix (#169). The
 * observed route waits for this tag to upgrade, which forces the
 * component to ship even though its own render is inert. The probe
 * asserts the browser actually downloads THIS module (the observation
 * would silently break if it were elided). The build-stamp element is the
 * counterpart, an unobserved display-only component that is never
 * downloaded.
 *
 * The doc prose here avoids literal tag-in-angle-brackets and whenDefined
 * syntax, which is a habit from before #179: comments are masked before
 * every signal scan now, so such prose registers as nothing. See
 * observe-badge.ts for the actual observer code.
 */
export class ObservedBadge extends WebComponent {
  render() {
    return html`<span
      class="font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground/70"
      >observed badge · registers because something waits for it</span
    >`;
  }
}
ObservedBadge.register('observed-badge');
