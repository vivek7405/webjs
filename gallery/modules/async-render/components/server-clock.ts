// async render() awaits server data directly in the leaf component. Three
// decoupled concerns to know (see AGENTS.md "Async render"):
//   1. SSR always BLOCKS, so the resolved data is in the first paint with no
//      fallback markup (progressive-enhancement safe, readable with JS off).
//   2. The client re-fetch default is stale-while-revalidate (old content stays
//      until the new render resolves, no blank flash).
//   3. renderFallback() is the OPTIONAL re-fetch loading UI, never first paint.
// Reach for async render() when request-time SERVER data belongs in the first
// paint; reach for a Task / signals for genuinely client-only data.
import { WebComponent, html } from '@webjsdev/core';
import { serverGreeting } from '../queries/server-greeting.server.ts';

export class ServerClock extends WebComponent {
  // A bare async-render component (no other client signal, light DOM) is
  // ELIDED: its SSR'd HTML is already the complete output, so the framework
  // serves it with ZERO JavaScript and skips the redundant on-hydration
  // re-fetch. This is the common fetch-and-display leaf shape. If you ever need
  // to force a component to ship when the analyser would elide it (for
  // interactivity static analysis cannot see, like an observer that computes
  // the tag it waits for), declare `static interactive = true`. Run
  // `webjs elision` to see the verdict for every component in this app.
  async render() {
    const info = await serverGreeting();
    return html`<p class="font-mono text-sm">server rendered this at
      <strong>${info.at}</strong> (pid ${info.pid})</p>`;
  }
}
ServerClock.register('server-clock');
