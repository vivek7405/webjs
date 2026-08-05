import { html } from '@webjsdev/core';

// A page that renders fine until something breaks it, so a test can reach the
// state where an overlay is legitimately live for the page you ARE on and then
// navigate away from it. That is the half of #1047 the prefetch case cannot
// reach: a re-render of the current page fails (another tab, a revalidation, a
// background fetch), the overlay goes up correctly, and it must come down when
// the client router takes you somewhere else.
export default function Flaky() {
  if ((globalThis as Record<string, unknown>).__wjFlakyBroken) {
    throw new Error('demo: flaky page threw during render');
  }
  return html`
    <h1 id="flaky">flaky</h1>
    <a id="flaky-to-good" href="/good">good</a>
  `;
}
