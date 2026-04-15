import { html, notFound } from 'webjs';
import '../../../components/muted-text.js';
import '../../../modules/comments/components/comments-thread.js';

import { getPost } from '../../../modules/posts/queries/get-post.server.js';
import { listComments } from '../../../modules/comments/queries/list-comments.server.js';
import { currentUser } from '../../../modules/auth/queries/current-user.server.js';

/** @param {{ params: { slug: string } }} ctx */
export async function generateMetadata({ params }) {
  const post = await getPost({ slug: params.slug });
  return post
    ? { title: `${post.title} — webjs blog` }
    : { title: 'Not found — webjs blog' };
}

export default async function PostPage({ params }) {
  const post = await getPost({ slug: params.slug });
  if (!post) notFound();

  const [comments, me] = await Promise.all([
    listComments({ postId: post.id }),
    currentUser(),
  ]);

  return html`
    <style>
      .back {
        display: inline-block;
        color: var(--fg-muted);
        text-decoration: none;
        font-size: 13px;
        margin-bottom: var(--sp-5);
        transition: color var(--t-fast);
      }
      .back:hover { color: var(--fg); }

      article h1 {
        margin: 0 0 var(--sp-3);
        letter-spacing: -0.02em;
      }
      article .byline {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding-bottom: var(--sp-5);
        margin-bottom: var(--sp-6);
        border-bottom: 1px solid var(--border);
      }
      article .body {
        font-size: 17px;
        line-height: 1.75;
        color: var(--fg);
        white-space: pre-wrap;
      }
      article .body::first-letter {
        font-size: 3.4em;
        font-weight: 800;
        line-height: 0.9;
        float: left;
        margin: 8px 10px 0 0;
        color: var(--accent);
      }

      .comments-section h2 {
        margin-top: var(--sp-8);
      }
    </style>

    <a class="back" href="/">← All posts</a>
    <article>
      <h1>${post.title}</h1>
      <div class="byline">
        <muted-text>
          by <strong>${post.authorName || 'someone'}</strong>
          · ${new Date(post.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        </muted-text>
      </div>
      <div class="body">${post.body}</div>
    </article>

    <div class="comments-section">
      <h2>Comments · ${comments.length}</h2>
      <comments-thread
        post-id=${String(post.id)}
        initial=${JSON.stringify(comments)}
        ?signed-in=${!!me}
      ></comments-thread>
    </div>
  `;
}
