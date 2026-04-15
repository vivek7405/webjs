import { html } from 'webjs';
import '../components/counter.js';
import '../components/new-post.js';
import '../components/muted-text.js';
import { listPosts } from '../actions/posts.server.js';

export const metadata = {
  title: 'webjs blog — home',
  description: 'A tiny blog built on webjs',
  openGraph: { title: 'webjs blog', type: 'website' },
};

/**
 * Home page — lists posts from the database and shows interactive bits.
 * Runs ONLY on the server; the TemplateResult is serialised and shipped.
 */
export default async function HomePage() {
  const posts = await listPosts();
  return html`
    <h1>Posts</h1>
    ${posts.length === 0
      ? html`<p><em>No posts yet — create one below.</em></p>`
      : html`
          <ul>
            ${posts.map(
              (p) => html`
                <li>
                  <a href="/blog/${p.slug}">${p.title}</a>
                  <muted-text>(${new Date(p.createdAt).toLocaleDateString()})</muted-text>
                </li>
              `
            )}
          </ul>
        `}

    <hr />

    <h2>New post</h2>
    <new-post></new-post>

    <h2>Interactive counter</h2>
    <p>Pure client-side state in a web component, server-rendered then hydrated:</p>
    <my-counter count="3"></my-counter>
  `;
}
