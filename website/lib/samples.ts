export const COMPONENT_SAMPLE = `import { WebComponent, html, signal } from '@webjsdev/core';

class LikeButton extends WebComponent {
  likes = signal(0);
  render() {
    return html\`<button @click=\${() => this.likes.set(this.likes.get() + 1)}>
      ♥ \${this.likes.get()}
    </button>\`;
  }
}
LikeButton.register('like-button');`;

export const TOGGLE_SAMPLE = `import { WebComponent, html, prop } from '@webjsdev/core';

class DarkModeToggle extends WebComponent({ enabled: prop(Boolean) }) {
  render() {
    return html\`<button @click=\${() => this.enabled = !this.enabled}>
      \${this.enabled ? '🌙 Dark' : '☀️ Light'}
    </button>\`;
  }
}
DarkModeToggle.register('dark-mode-toggle');`;

export const ACTION_SAMPLE = `'use server';
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';

// Import this from a page or component. In the
// browser the import becomes an RPC call. On the
// server it is just this function. No fetch by hand.
export async function getPost(id) {
  const [post] = await db.select()
    .from(posts)
    .where(eq(posts.id, id));
  return post;
}`;

export const PAGE_SAMPLE = `import { html, notFound } from '@webjsdev/core';
import { getPost } from '#actions/get-post.server.ts';
import '#components/like-button.ts';

export default async function Post({ params }) {
  const post = await getPost(params.id);
  if (!post) notFound();
  return html\`<article>
    <h1>\${post.title}</h1>
    <like-button></like-button>
  </article>\`;
}`;

export const PE_COMPONENT = `class LikeButton extends WebComponent({ count: Number }) {
  render() {
    return html\`<button @click=\${() => this.count++}>
      ♥ \${this.count}
    </button>\`;
  }
}
LikeButton.register('like-button');`;

export const SSR_OUTPUT = `<!-- what the browser receives, before any JS -->
<like-button count="3">
  <button>♥ 3</button>
</like-button>

<!-- The count reads. A plain link navigates, a
     form submits to a server action. JavaScript
     then upgrades the click in place, only where
     an interaction actually needs it. -->`;

export const USAGE_SAMPLE = `<like-button count="3"></like-button>`;

/**
 * The two framework-source windows, VERBATIM from the packages that ship to
 * every app's node_modules. Contiguous, unedited, de-indented only. That
 * fidelity is the argument the section makes, so a reworded excerpt would be
 * a claim ABOUT readable source rather than a sample of it. Re-derive them
 * from the files rather than hand-editing here.
 *
 * Both were chosen against three constraints:
 *   1. The comment explains WHY, not what. That is the half a build step
 *      destroys and the half an agent needs.
 *   2. No backtick anywhere, per invariant 9, which rules out most of the
 *      codebase's JSDoc.
 *   3. Code-dominant. The first core pick was 5 comment lines to 4 of code
 *      and read as documentation rather than as the source that runs, which
 *      is the opposite of the point. Aim for 3 comment to 7 code or better.
 *      That pick also STARTED MID-SENTENCE, because its comment opened two
 *      lines earlier on a line containing backticks. Check that an excerpt
 *      begins where its comment does.
 *   4. At most 69 columns. Real source runs to 78 at p90, and a two-up card
 *      at the 1152px grid holds 74 at 12px, so most of the codebase simply
 *      does not fit beside itself. Check the width before swapping either.
 */
export const CORE_SOURCE_SAMPLE = `// Dispose the signal watcher so dependency edges drop. Without
// this the element holds references to module-scope signals
// (and vice versa) forever.
if (this.__signalWatcher) {
  this.__signalWatcher.dispose();
  this.__signalWatcher = undefined;
}
for (const c of this.__controllers) {
  if (c.hostDisconnected) c.hostDisconnected();
}`;

export const SERVER_SOURCE_SAMPLE = `// 103 Early Hints: before running SSR, send preload hints for the
// page's module URLs so the browser can begin fetching them while
// the server is still computing the body. Skipped in dev (file churn
// would send stale URLs after rebuilds) and for non-GET/HEAD.
if (
  !dev &&
  (req.method === 'GET' || req.method === 'HEAD') &&
  typeof res.writeEarlyHints === 'function'
) {
  const match = app.routeFor(url.pathname);`;
