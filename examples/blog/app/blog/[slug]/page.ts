import { html, notFound } from 'webjs';
import '../../../components/muted-text.ts';
import '../../../modules/comments/components/comments-thread.ts';

import { getPost } from '../../../modules/posts/queries/get-post.server.ts';
import { listComments } from '../../../modules/comments/queries/list-comments.server.ts';
import { currentUser } from '../../../modules/auth/queries/current-user.server.ts';

type Ctx = { params: { slug: string } };

export async function generateMetadata({ params }: Ctx) {
  const post = await getPost({ slug: params.slug });
  return post
    ? { title: `${post.title} — webjs blog` }
    : { title: 'Not found — webjs blog' };
}

export default async function PostPage({ params }: Ctx) {
  const post = await getPost({ slug: params.slug });
  if (!post) notFound();

  const [comments, me] = await Promise.all([
    listComments({ postId: post.id }),
    currentUser(),
  ]);

  const date = new Date(post.createdAt);
  const readingMin = Math.max(1, Math.round(post.body.split(/\s+/).length / 220));

  return html`
    <style>
      .back {
        display: inline-block;
        margin-bottom: var(--sp-7);
        color: var(--fg-subtle);
        text-decoration: none;
        font: 500 11px/1 var(--font-mono);
        letter-spacing: 0.15em;
        text-transform: uppercase;
        transition: color var(--t-fast);
      }
      .back:hover { color: var(--fg); }

      article header {
        margin-bottom: var(--sp-7);
      }
      .rubric {
        display: block;
        font: 600 11px/1 var(--font-mono);
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-4);
      }
      article h1 {
        font-family: var(--font-serif);
        font-size: var(--fs-display);
        line-height: 1.02;
        letter-spacing: -0.035em;
        font-weight: 700;
        margin: 0 0 var(--sp-5);
        text-wrap: balance;
      }
      .byline {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        padding: var(--sp-4) 0;
        border-top: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
        font: 500 11px/1.4 var(--font-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--fg-subtle);
      }
      .byline strong { color: var(--fg); font-weight: 700; }
      .byline .sep  { color: var(--fg-subtle); }

      article .body {
        font-family: var(--font-serif);
        font-size: 1.14rem;
        line-height: 1.75;
        color: var(--fg);
        white-space: pre-wrap;
        margin: var(--sp-6) 0;
      }
      article .body::first-letter {
        font-size: 4em;
        font-weight: 700;
        line-height: 0.9;
        float: left;
        margin: 10px 14px 0 0;
        color: var(--accent);
        font-family: var(--font-serif);
      }

      .comments-section {
        margin-top: var(--sp-8);
        padding-top: var(--sp-6);
        border-top: 1px solid var(--border);
      }
      .comments-section h2 {
        font-family: var(--font-serif);
        font-size: 1.5rem;
        letter-spacing: -0.02em;
        margin: 0 0 var(--sp-4);
      }
      .comments-section h2 small {
        font: 500 11px/1 var(--font-mono);
        letter-spacing: 0.15em;
        color: var(--fg-subtle);
        margin-left: var(--sp-2);
        text-transform: uppercase;
      }
    </style>

    <a class="back" href="/">← Posts</a>
    <article>
      <header>
        <span class="rubric">● post</span>
        <h1>${post.title}</h1>
        <div class="byline">
          <span>By <strong>${post.authorName || 'someone'}</strong></span>
          <span class="sep">·</span>
          <span>${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          <span class="sep">·</span>
          <span>${readingMin} min read</span>
        </div>
      </header>
      <div class="body">${post.body}</div>
    </article>

    <div class="comments-section">
      <h2>Comments <small>${comments.length.toString().padStart(2, '0')} total</small></h2>
      <comments-thread
        post-id=${String(post.id)}
        initial=${JSON.stringify(comments)}
        ?signed-in=${!!me}
      ></comments-thread>
    </div>
  `;
}
