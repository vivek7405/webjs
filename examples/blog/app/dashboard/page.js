import { html, repeat } from 'webjs';
import '../../components/muted-text.ts';
import { currentUser } from '../../modules/auth/queries/current-user.server.ts';
import { listPosts } from '../../modules/posts/queries/list-posts.server.ts';

export const metadata = { title: 'Dashboard — webjs blog' };

export default async function Dashboard() {
  const me = await currentUser();
  const posts = await listPosts();
  const mine = posts.filter((p) => p.authorId === me.id);
  return html`
    <style>
      .rubric {
        display: block;
        font: 600 11px/1 var(--font-mono);
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-3);
      }
      .greeting h1 {
        font-family: var(--font-serif);
        font-size: clamp(2rem, 1.5rem + 1.8vw, 2.8rem);
        line-height: 1.08;
        letter-spacing: -0.03em;
        font-weight: 700;
        margin: 0 0 var(--sp-3);
      }
      .greeting p { color: var(--fg-muted); margin: 0 0 var(--sp-6); }
      .greeting strong { color: var(--fg); }

      .toolbar {
        display: flex;
        gap: var(--sp-3);
        margin-bottom: var(--sp-8);
      }
      .toolbar a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: var(--sp-3) var(--sp-5);
        font: 600 13px/1 var(--font-sans);
        letter-spacing: 0.02em;
        border-radius: 999px;
        text-decoration: none;
        transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
      }
      .toolbar a.primary {
        background: var(--accent);
        color: var(--accent-fg);
      }
      .toolbar a.primary:hover { background: var(--accent-hover); }
      .toolbar a.secondary {
        background: transparent;
        border: 1px solid var(--border-strong);
        color: var(--fg-muted);
      }
      .toolbar a.secondary:hover { color: var(--fg); border-color: var(--fg-muted); }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: var(--sp-4);
      }
      .section-head h2 {
        font-family: var(--font-serif);
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0;
      }
      .section-head small {
        font: 500 11px/1 var(--font-mono);
        letter-spacing: 0.15em;
        color: var(--fg-subtle);
        text-transform: uppercase;
      }

      .posts { list-style: none; padding: 0; margin: 0; }
      .posts li {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--sp-4);
        padding: var(--sp-4) 0;
        border-bottom: 1px solid var(--border);
      }
      .posts li:first-child { border-top: 1px solid var(--border); }
      .posts a {
        font-family: var(--font-serif);
        font-size: 1.1rem;
        text-decoration: none;
        color: var(--fg);
        font-weight: 600;
        letter-spacing: -0.01em;
        transition: color var(--t-fast);
      }
      .posts a:hover { color: var(--accent); }

      .empty {
        padding: var(--sp-7);
        text-align: center;
        border: 1px dashed var(--border);
        border-radius: var(--rad-lg);
        color: var(--fg-muted);
        font: italic 15px/1.6 var(--font-serif);
      }
      .empty a { color: var(--accent); font-weight: 600; text-decoration: none; font-style: normal; }
      .empty a:hover { text-decoration: underline; text-underline-offset: 3px; }
    </style>

    <section class="greeting">
      <span class="rubric">● signed in</span>
      <h1>Hello, ${me.name || me.email.split('@')[0]}.</h1>
      <p>You are ${me.name ? html`<strong>${me.email}</strong>` : ''}${me.name ? ' · ' : ''}a member since ${new Date(me.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}.</p>
    </section>

    <div class="toolbar">
      <a class="primary" href="/dashboard/posts/new">+ New post</a>
      <a class="secondary" href="#" data-logout>Log out</a>
    </div>

    <div class="section-head">
      <h2>Your posts</h2>
      <small>${mine.length.toString().padStart(2, '0')} published</small>
    </div>

    ${mine.length === 0
      ? html`<div class="empty">
          You haven't published anything yet. <a href="/dashboard/posts/new">Write your first post →</a>
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
