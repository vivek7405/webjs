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

// Import this from a page or component. WebJs
// rewrites the import into a typed RPC stub (the
// real call at SSR). No fetch by hand.
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
