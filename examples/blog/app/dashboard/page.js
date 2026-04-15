import { html, repeat } from 'webjs';
import '../../components/muted-text.js';
import { currentUser } from '../../modules/auth/queries/current-user.server.js';
import { listPosts } from '../../modules/posts/queries/list-posts.server.js';

export const metadata = { title: 'Dashboard — webjs blog' };

export default async function Dashboard() {
  const me = await currentUser();
  const posts = await listPosts();
  const mine = posts.filter((p) => p.authorId === me.id);
  return html`
    <style>
      .greeting { margin-bottom: var(--sp-6); }
      .greeting h1 { margin: 0 0 var(--sp-2); }
      .greeting p  { margin: 0; color: var(--fg-muted); }

      .toolbar {
        display: flex;
        gap: var(--sp-3);
        margin-bottom: var(--sp-6);
      }
      .toolbar a {
        display: inline-block;
        padding: var(--sp-2) var(--sp-4);
        font: 600 14px/1 var(--font-sans);
        border-radius: var(--rad);
        text-decoration: none;
        transition: background var(--t-fast), border-color var(--t-fast);
      }
      .toolbar a.primary {
        background: var(--accent);
        color: var(--accent-fg);
      }
      .toolbar a.primary:hover { background: var(--accent-hover); border-bottom: 0 !important; }
      .toolbar a.secondary {
        background: var(--bg-elev);
        border: 1px solid var(--border-strong);
        color: var(--fg-muted);
      }
      .toolbar a.secondary:hover { color: var(--fg); border-color: var(--fg-muted); border-bottom: 0 !important; }

      .posts { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-3); }
      .posts li {
        display: flex; align-items: baseline; justify-content: space-between;
        padding: var(--sp-3) var(--sp-4);
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--rad);
        gap: var(--sp-3);
      }
      .posts a { text-decoration: none; color: var(--fg); font-weight: 600; }
      .posts a:hover { color: var(--accent); border-bottom: 0 !important; }

      .empty {
        padding: var(--sp-6);
        text-align: center;
        border: 1px dashed var(--border);
        border-radius: var(--rad-lg);
        color: var(--fg-muted);
      }
    </style>

    <div class="greeting">
      <h1>Dashboard</h1>
      <p>Signed in as <strong>${me.name || me.email}</strong>.</p>
    </div>

    <div class="toolbar">
      <a class="primary" href="/dashboard/posts/new">+ New post</a>
      <a class="secondary" href="#" data-logout>Log out</a>
    </div>

    <h2>Your posts</h2>
    ${mine.length === 0
      ? html`<div class="empty">
          <p>You haven't published anything yet.</p>
          <p><a href="/dashboard/posts/new">Write your first post →</a></p>
        </div>`
      : html`<ul class="posts">
          ${repeat(mine, (p) => p.id, (p) => html`
            <li>
              <a href="/blog/${p.slug}">${p.title}</a>
              <muted-text>${new Date(p.createdAt).toLocaleDateString()}</muted-text>
            </li>`)}
        </ul>`}

    <script type="module">
      document.querySelector('[data-logout]')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        location.href = '/';
      });
    </script>
  `;
}
