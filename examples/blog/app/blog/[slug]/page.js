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
    <p><a href="/">← All posts</a></p>
    <article>
      <h1>${post.title}</h1>
      <muted-text>
        by ${post.authorName || 'someone'}
        · ${new Date(post.createdAt).toLocaleString()}
      </muted-text>
      <p>${post.body}</p>
    </article>

    <hr />

    <h2>Comments</h2>
    <comments-thread
      post-id=${String(post.id)}
      initial=${JSON.stringify(comments)}
      ?signed-in=${!!me}
    ></comments-thread>
  `;
}
