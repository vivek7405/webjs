import { html } from 'webjs';

export const metadata = { title: 'About — webjs blog' };

/**
 * `/about` — served from app/(marketing)/about/page.js.
 * The `(marketing)` folder is a **route group**: it appears in the
 * filesystem so we can group related pages and share a layout, but it
 * does NOT appear in the URL.
 */
export default function About() {
  return html`
    <h1>About this demo</h1>
    <p>
      This blog exercises every feature of the webjs framework:
      SSR with Declarative Shadow DOM, async Suspense-streamed boundaries,
      fine-grained client renderer with keyed lists, server actions,
      expose()'d REST endpoints, CORS, per-segment middleware,
      rate limiting on auth endpoints, route groups (this page!),
      private folders, WebSockets for real-time chat and live comments,
      session-cookie auth, and Prisma-backed models.
    </p>
    <p>
      The app is organised the same way as pilot-platform's Next.js build:
      thin routes in <code>app/</code>, feature modules in <code>modules/</code>
      (<code>actions/</code>, <code>queries/</code>, <code>utils/</code>,
      <code>types.js</code>), cross-cutting infra in <code>lib/</code>.
    </p>
    <p><a href="/">← Back to posts</a></p>
  `;
}
