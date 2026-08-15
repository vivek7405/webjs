import { html } from '@webjsdev/core';

// The boundary for the throwing page next to it. It is nested at `/crash`
// rather than at the app root deliberately: that is the shape #1298 is about,
// a boundary that has a layout ABOVE it which must stay on screen. The root
// layout (with its interactive `counter-el`) wraps this, so a navigation into
// the throwing page is a SOFT one and the chrome around it survives.
export default function CrashBoundary({ error }: { error: Error }) {
  return html`<h1 id="crash-boundary">boundary: ${error.message}</h1>`;
}
