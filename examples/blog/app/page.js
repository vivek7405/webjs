import { html, repeat, Suspense } from 'webjs';
import '../components/counter.ts';
import '../components/muted-text.ts';
import '../modules/chat/components/chat-box.js';

import { listPosts } from '../modules/posts/queries/list-posts.server.ts';
import { currentUser } from '../modules/auth/queries/current-user.server.js';

export const metadata = {
  title: 'webjs blog',
  description: 'A tiny full-feature demo of the webjs framework',
  openGraph: { title: 'webjs blog', type: 'website' },
};

async function slowStat() {
  await new Promise((r) => setTimeout(r, 400));
  return html`<muted-text>posts loaded · ${new Date().toLocaleTimeString()}</muted-text>`;
}

export default async function HomePage() {
  const [me, posts] = await Promise.all([currentUser(), listPosts()]);
  return html`
    <style>
      .rubric {
        display: block;
        font: 600 11px/1 var(--font-mono);
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-4);
      }
      .hero {
        margin: 0 0 var(--sp-8);
      }
      .hero h1 {
        font-size: var(--fs-display);
        line-height: 1.02;
        letter-spacing: -0.035em;
        font-weight: 700;
        margin: 0 0 var(--sp-4);
        text-wrap: balance;
      }
      .hero p {
        font-size: var(--fs-lede);
        line-height: 1.5;
        color: var(--fg-muted);
        max-width: 56ch;
        margin: 0;
      }
      .hero .accent-letter { color: var(--accent); font-style: italic; }

      /* ---------- editorial post feed (no cards) ---------- */
      .feed { list-style: none; padding: 0; margin: 0; }
      .feed li { border-top: 1px solid var(--border); }
      .feed li:last-child { border-bottom: 1px solid var(--border); }
      .feed a {
        display: grid;
        grid-template-columns: 44px 1fr auto;
        gap: var(--sp-4);
        align-items: baseline;
        padding: var(--sp-5) 0;
        color: inherit;
        text-decoration: none;
        transition: padding var(--t);
      }
      .feed a:hover { padding-left: var(--sp-2); }
      .feed .num {
        font: 500 11px/1 var(--font-mono);
        letter-spacing: 0.1em;
        color: var(--fg-subtle);
        padding-top: 6px;
      }
      .feed .title-row { display: grid; gap: 4px; min-width: 0; }
      .feed h3 {
        font-family: var(--font-serif);
        font-size: 1.45rem;
        line-height: 1.2;
        letter-spacing: -0.02em;
        font-weight: 600;
        margin: 0;
        color: var(--fg);
        transition: color var(--t-fast);
      }
      .feed a:hover h3 { color: var(--accent); }
      .feed .preview {
        font-size: 14px;
        line-height: 1.55;
        color: var(--fg-muted);
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .feed .arrow {
        font-family: var(--font-mono);
        color: var(--fg-subtle);
        transition: color var(--t-fast), transform var(--t);
      }
      .feed a:hover .arrow { color: var(--accent); transform: translateX(4px); }

      .empty-feed {
        padding: var(--sp-8);
        text-align: center;
        color: var(--fg-muted);
        border-top: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
      }

      .banner {
        padding: var(--sp-5);
        background: color-mix(in oklch, var(--bg-elev) 50%, transparent);
        border: 1px solid var(--border);
        border-radius: var(--rad);
        font-size: 14px;
        margin: var(--sp-5) 0 var(--sp-7);
        color: var(--fg-muted);
      }
      .banner strong { color: var(--fg); }
      .banner a { color: var(--accent); font-weight: 600; text-decoration: none; }
      .banner a:hover { text-decoration: underline; text-underline-offset: 3px; }

      .section {
        margin-top: var(--sp-8);
        padding-top: var(--sp-5);
        border-top: 1px solid var(--border);
      }
      .section h2 {
        font-family: var(--font-serif);
        font-size: 1.6rem;
        letter-spacing: -0.02em;
        font-weight: 700;
        margin: 0 0 var(--sp-2);
      }
      .section p { color: var(--fg-muted); margin: 0 0 var(--sp-4); font-size: 14px; }

      .stat {
        font: 500 11px/1 var(--font-mono);
        letter-spacing: 0.15em;
        color: var(--fg-subtle);
        text-transform: uppercase;
      }
    </style>

    <section class="hero">
      <span class="rubric">● the webjs demo</span>
      <h1>A blog, a chat, a login — all in <span class="accent-letter">one</span> tiny framework.</h1>
      <p>
        Every line of this page runs on webjs: server-rendered web components, file-based routes,
        server actions, streaming Suspense, live WebSockets. Zero bundler. Authored in plain JavaScript
        with JSDoc.
      </p>
    </section>

    ${me
      ? html`<p class="banner">Welcome back, <strong>${me.name || me.email}</strong>. <a href="/dashboard">Your dashboard →</a></p>`
      : html`<p class="banner"><a href="/login">Sign in</a> or <a href="/login?then=/dashboard/posts/new">create an account</a> to write posts and comment.</p>`}

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin:var(--sp-6) 0 var(--sp-2)">
      <span class="rubric" style="margin:0">Latest posts</span>
      <span class="stat">${posts.length.toString().padStart(2, '0')} total</span>
    </div>

    ${posts.length === 0
      ? html`<div class="empty-feed">
          <p>No posts yet.</p>
          <p><a href="/dashboard/posts/new">Write the first one →</a></p>
        </div>`
      : html`<ul class="feed">
          ${repeat(posts, (p) => p.id, (p, i) => html`
            <li>
              <a href="/blog/${p.slug}">
                <span class="num">${(i + 1).toString().padStart(2, '0')}</span>
                <div class="title-row">
                  <h3>${p.title}</h3>
                  <p class="preview">${p.body}</p>
                  <muted-text>${p.authorName || 'someone'} · ${new Date(p.createdAt).toLocaleDateString()}</muted-text>
                </div>
                <span class="arrow">→</span>
              </a>
            </li>`)}
        </ul>`}

    <p style="margin-top:var(--sp-5);">${Suspense({
      fallback: html`<muted-text>computing timestamp…</muted-text>`,
      children: slowStat(),
    })}</p>

    <section class="section">
      <span class="rubric">● client-side state</span>
      <h2>Interactive counter</h2>
      <p>Pure client-side state in a web component. SSR'd with the initial value, hydrated on connect, clicks don't lose focus.</p>
      <my-counter count="3"></my-counter>
    </section>

    <section class="section">
      <span class="rubric">● real-time · websocket</span>
      <h2>Live chat</h2>
      <p>Open this page in two windows — messages broadcast across every connected client.</p>
      <chat-box></chat-box>
    </section>
  `;
}
