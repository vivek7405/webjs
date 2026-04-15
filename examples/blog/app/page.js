import { html, repeat, Suspense } from 'webjs';
import '../components/counter.js';
import '../components/muted-text.js';
import '../modules/chat/components/chat-box.js';

import { listPosts } from '../modules/posts/queries/list-posts.server.js';
import { currentUser } from '../modules/auth/queries/current-user.server.js';

export const metadata = {
  title: 'webjs blog',
  description: 'A tiny full-feature demo of the webjs framework',
  openGraph: { title: 'webjs blog', type: 'website' },
};

async function slowStat() {
  await new Promise((r) => setTimeout(r, 400));
  return html`<muted-text>posts loaded at ${new Date().toLocaleTimeString()}</muted-text>`;
}

export default async function HomePage() {
  const [me, posts] = await Promise.all([currentUser(), listPosts()]);
  return html`
    <style>
      .hero { margin: 0 0 var(--sp-7); }
      .hero h1 { margin: 0 0 var(--sp-3); }
      .hero p { font-size: 1.1rem; color: var(--fg-muted); margin: 0; max-width: 56ch; }

      .posts { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-4); }
      .post-card {
        display: block;
        padding: var(--sp-4) var(--sp-5);
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--rad-lg);
        text-decoration: none;
        color: inherit;
        box-shadow: var(--shadow-sm);
        transition: border-color var(--t), box-shadow var(--t), transform var(--t);
      }
      .post-card:hover {
        border-color: var(--border-strong);
        box-shadow: var(--shadow);
        transform: translateY(-1px);
      }
      .post-card h3 {
        margin: 0 0 4px;
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--fg);
        letter-spacing: -0.01em;
      }
      .post-card .preview {
        color: var(--fg-muted);
        font-size: 14px;
        margin: 6px 0 var(--sp-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .empty-posts {
        padding: var(--sp-7);
        text-align: center;
        color: var(--fg-muted);
        background: var(--bg-elev);
        border: 1px dashed var(--border);
        border-radius: var(--rad-lg);
      }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-top: var(--sp-7);
        margin-bottom: var(--sp-4);
        padding-bottom: var(--sp-2);
        border-bottom: 1px solid var(--border);
      }
      .section-head h2 { margin: 0; font-size: 1.15rem; }
      .section-head small { color: var(--fg-subtle); font-size: 13px; }

      .welcome {
        padding: var(--sp-4);
        background: var(--accent-tint);
        border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
        border-radius: var(--rad);
        font-size: 14px;
        margin-bottom: var(--sp-6);
      }
      .welcome a { color: var(--accent); font-weight: 600; }

      .cta-link {
        display: inline-block;
        padding: var(--sp-2) var(--sp-4);
        background: var(--accent);
        color: var(--accent-fg);
        border-radius: var(--rad);
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        transition: background var(--t-fast);
      }
      .cta-link:hover { background: var(--accent-hover); }
    </style>

    <section class="hero">
      <h1>A framework demo — with real posts, chat, and auth</h1>
      <p>
        Everything here runs on webjs: server-rendered web components,
        file-based routes, server actions, Suspense-streamed boundaries,
        live WebSocket comments and chat. Zero bundler.
      </p>
    </section>

    ${me
      ? html`<p class="welcome">
          Welcome back, <strong>${me.name || me.email}</strong>.
          <a href="/dashboard">Go to your dashboard →</a>
        </p>`
      : html`<p class="welcome">
          <a href="/login">Sign in</a> or
          <a href="/login?then=/dashboard/posts/new">create an account</a>
          to write posts and comment.
        </p>`}

    <div class="section-head">
      <h2>Latest posts</h2>
      <small>${posts.length} total</small>
    </div>

    ${posts.length === 0
      ? html`<div class="empty-posts">
          <p><strong>No posts yet.</strong></p>
          <p><a class="cta-link" href="/dashboard/posts/new">Write the first one →</a></p>
        </div>`
      : html`<ul class="posts">
          ${repeat(posts, (p) => p.id, (p) => html`
            <li>
              <a class="post-card" href="/blog/${p.slug}">
                <h3>${p.title}</h3>
                <div class="preview">${p.body}</div>
                <muted-text>by ${p.authorName || 'someone'} · ${new Date(p.createdAt).toLocaleDateString()}</muted-text>
              </a>
            </li>
          `)}
        </ul>`}

    <p>${Suspense({
      fallback: html`<muted-text>(computing timestamp…)</muted-text>`,
      children: slowStat(),
    })}</p>

    <div class="section-head">
      <h2>Interactive counter</h2>
      <small>client-side state, shadow DOM</small>
    </div>
    <p><muted-text>SSR'd then hydrated. Clicking updates state without losing focus.</muted-text></p>
    <my-counter count="3"></my-counter>

    <div class="section-head">
      <h2>Real-time chat</h2>
      <small>WebSocket · all tabs see it</small>
    </div>
    <chat-box></chat-box>
  `;
}
