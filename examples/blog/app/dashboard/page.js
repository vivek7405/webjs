import { html } from 'webjs';
import '../../components/muted-text.js';
import { currentUser } from '../../modules/auth/queries/current-user.server.js';
import { listPosts } from '../../modules/posts/queries/list-posts.server.js';

export const metadata = { title: 'Dashboard — webjs blog' };

export default async function Dashboard() {
  const me = await currentUser();
  const posts = await listPosts();
  const mine = posts.filter((p) => p.authorId === me.id);
  return html`
    <h1>Your dashboard</h1>
    <p>Signed in as <strong>${me.name || me.email}</strong>.</p>
    <p>
      <a href="/dashboard/posts/new">+ New post</a>
      &nbsp;·&nbsp;
      <a href="/api/auth/logout" data-logout>Log out</a>
    </p>
    <h2>Your posts</h2>
    ${mine.length === 0
      ? html`<p><muted-text>You haven't posted anything yet.</muted-text></p>`
      : html`<ul>${mine.map((p) => html`
          <li>
            <a href="/blog/${p.slug}">${p.title}</a>
            <muted-text>(${new Date(p.createdAt).toLocaleDateString()})</muted-text>
          </li>`)}</ul>`}
    <script type="module">
      document.querySelector('[data-logout]')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        location.href = '/';
      });
    </script>
  `;
}
