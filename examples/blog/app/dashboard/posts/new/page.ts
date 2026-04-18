import { html } from 'webjs';
import '../../../../modules/posts/components/new-post.ts';

export const metadata = { title: 'New post — webjs blog' };

export default function NewPostPage() {
  return html`
    <a href="/dashboard" class="inline-block mb-6 text-fg-subtle no-underline font-mono text-[11px] leading-none font-medium tracking-[0.15em] uppercase transition-colors duration-fast hover:text-fg">← Dashboard</a>
    <span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-accent mb-3">● compose</span>
    <h1 class="font-serif text-[clamp(2rem,1.5rem+1.6vw,2.6rem)] leading-[1.08] tracking-[-0.03em] font-bold m-0 mb-8">A new post.</h1>
    <new-post></new-post>
  `;
}
