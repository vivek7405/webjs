import { html, repeat } from 'webjs';
import '../../components/muted-text.ts';
import { currentUser } from '../../modules/auth/queries/current-user.server.ts';
import { listPosts } from '../../modules/posts/queries/list-posts.server.ts';
import { rubric, clampH1, stat, accentLink } from '../_utils/ui.ts';

export const metadata = { title: 'Dashboard — webjs blog' };

export default async function Dashboard() {
  // Per-segment middleware.ts guarantees an authed user here.
  const me = (await currentUser())!;
  const posts = await listPosts();
  const mine = posts.filter((p) => p.authorId === me.id);
  return html`
    <section>
      ${rubric('signed in', 'sm')}
      ${clampH1(`Hello, ${me.name || me.email.split('@')[0]}.`)}
      <p class="text-fg-muted m-0 mb-8">You are ${me.name ? html`<strong class="text-fg">${me.email}</strong>` : ''}${me.name ? ' · ' : ''}a member since ${new Date(me.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}.</p>
    </section>

    <div class="flex gap-3 mb-18">
      <a href="/dashboard/posts/new" class="inline-flex items-center gap-1.5 px-6 py-3 font-sans font-semibold text-[13px] leading-none tracking-[0.02em] rounded-full no-underline transition-[background,border-color,color] duration-fast bg-accent text-accent-fg hover:bg-accent-hover">+ New post</a>
      <a href="#" data-logout class="inline-flex items-center gap-1.5 px-6 py-3 font-sans font-semibold text-[13px] leading-none tracking-[0.02em] rounded-full no-underline transition-[background,border-color,color] duration-fast bg-transparent border border-border-strong text-fg-muted hover:text-fg hover:border-fg-muted">Log out</a>
    </div>

    <div class="flex items-baseline justify-between mb-4">
      <h2 class="font-serif text-[1.5rem] font-bold tracking-[-0.02em] m-0">Your posts</h2>
      ${stat(`${mine.length.toString().padStart(2, '0')} published`)}
    </div>

    ${mine.length === 0
      ? html`<div class="py-12 text-center border border-dashed border-border rounded-[14px] text-fg-muted italic font-serif text-[15px] leading-[1.6]">
          You haven't published anything yet.
          ${accentLink('/dashboard/posts/new', 'Write your first post →')}
        </div>`
      : html`<ul class="list-none p-0 m-0">
          ${repeat(mine, (p) => p.id, (p) => html`
            <li class="flex items-baseline justify-between gap-4 py-4 border-b border-border first:border-t">
              <a href="/blog/${p.slug}" class="font-serif text-[1.1rem] no-underline text-fg font-semibold tracking-[-0.01em] transition-colors duration-fast hover:text-accent">${p.title}</a>
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
