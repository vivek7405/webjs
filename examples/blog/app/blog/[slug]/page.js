import { html, notFound } from 'webjs';
import '../../../components/muted-text.js';
import { getPost } from '../../../actions/posts.server.js';

/** @param {{ params: { slug: string } }} ctx */
export async function generateMetadata({ params }) {
  const post = await getPost({ slug: params.slug });
  return post
    ? { title: `${post.title} — webjs blog` }
    : { title: 'Not found — webjs blog' };
}

/**
 * Dynamic post page at /blog/:slug.
 * @param {{ params: { slug: string } }} ctx
 */
export default async function PostPage({ params }) {
  const post = await getPost({ slug: params.slug });
  if (!post) notFound();
  return html`
    <p><a href="/">← All posts</a></p>
    <article>
      <h1>${post.title}</h1>
      <muted-text>${new Date(post.createdAt).toLocaleString()}</muted-text>
      <p>${post.body}</p>
    </article>
  `;
}
