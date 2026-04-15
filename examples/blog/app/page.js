import { html, repeat, Suspense } from 'webjs';
import '../components/counter.js';
import '../components/chat-box.js';
import '../components/muted-text.js';

import { listPosts } from '../modules/posts/queries/list-posts.server.js';
import { currentUser } from '../modules/auth/queries/current-user.server.js';

export const metadata = {
  title: 'webjs blog — home',
  description: 'A tiny full-feature demo of the webjs framework',
  openGraph: { title: 'webjs blog', type: 'website' },
};

async function slowStat() {
  await new Promise((r) => setTimeout(r, 400));
  return html`<muted-text>posts list rendered at ${new Date().toLocaleTimeString()}</muted-text>`;
}

export default async function HomePage() {
  const [me, posts] = await Promise.all([currentUser(), listPosts()]);
  return html`
    <h1>Posts</h1>

    ${posts.length === 0
      ? html`<p><em>No posts yet — <a href="/dashboard/posts/new">write the first one</a>.</em></p>`
      : html`
          <ul>
            ${repeat(
              posts,
              (p) => p.id,
              (p) => html`
                <li>
                  <a href="/blog/${p.slug}">${p.title}</a>
                  <muted-text>
                    by ${p.authorName || 'someone'}
                    · ${new Date(p.createdAt).toLocaleDateString()}
                  </muted-text>
                </li>
              `
            )}
          </ul>
        `}

    <p>${Suspense({
      fallback: html`<muted-text>(computing timestamp…)</muted-text>`,
      children: slowStat(),
    })}</p>

    <hr />

    ${me
      ? html`<p>Signed in as <strong>${me.name || me.email}</strong>. <a href="/dashboard">Your dashboard →</a></p>`
      : html`<p><a href="/login">Sign in</a> or <a href="/login?then=/dashboard/posts/new">sign up</a> to write posts.</p>`}

    <h2>Interactive counter</h2>
    <p>Pure client-side state in a web component, server-rendered then hydrated:</p>
    <my-counter count="3"></my-counter>

    <h2>Real-time chat</h2>
    <p>Open this page in two browser windows — messages broadcast over WebSocket:</p>
    <chat-box></chat-box>
  `;
}
