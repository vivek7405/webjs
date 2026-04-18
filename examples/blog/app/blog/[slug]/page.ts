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
    <a href="/" class="inline-block mb-12 text-fg-subtle no-underline font-mono text-[11px] leading-none font-medium tracking-[0.15em] uppercase transition-colors duration-fast hover:text-fg">← Posts</a>

    <article>
      <header class="mb-12">
        <span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-accent mb-4">● post</span>
        <h1 class="font-serif text-display leading-[1.02] tracking-[-0.035em] font-bold m-0 mb-6 text-balance">${post.title}</h1>
        <div class="flex items-center gap-3 py-4 border-y border-border font-mono text-[11px] leading-[1.4] font-medium tracking-[0.1em] uppercase text-fg-subtle">
          <span>By <strong class="text-fg font-bold">${post.authorName || 'someone'}</strong></span>
          <span class="text-fg-subtle">·</span>
          <span>${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          <span class="text-fg-subtle">·</span>
          <span>${readingMin} min read</span>
        </div>
      </header>
      <div class="font-serif text-[1.14rem] leading-[1.75] text-fg whitespace-pre-wrap my-8 first-letter:text-[4em] first-letter:font-bold first-letter:leading-[0.9] first-letter:float-left first-letter:mr-3.5 first-letter:mt-2.5 first-letter:text-accent first-letter:font-serif">${post.body}</div>
    </article>

    <div class="mt-18 pt-8 border-t border-border">
      <h2 class="font-serif text-[1.5rem] tracking-[-0.02em] m-0 mb-4">
        Comments
        <small class="font-mono text-[11px] leading-none font-medium tracking-[0.15em] text-fg-subtle ml-2 uppercase">${comments.length.toString().padStart(2, '0')} total</small>
      </h2>
      <comments-thread
        post-id=${String(post.id)}
        initial=${JSON.stringify(comments)}
        ?signed-in=${!!me}
      ></comments-thread>
    </div>
  `;
}
