import { html } from '@webjsdev/core';

// The page the user is actually looking at. It renders fine and links to a page
// that throws, the exact shape of the scaffold's boundaries index that #1047 was
// reported against: a plain <a>, so link prefetch fires a real GET of the
// throwing page on hover.
export default function Good() {
  return html`
    <h1 id="good">good</h1>
    <a id="to-crash" href="/crash">crash</a>
    <a id="to-flaky" href="/flaky">flaky</a>
  `;
}
