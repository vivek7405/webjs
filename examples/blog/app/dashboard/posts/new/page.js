import { html } from 'webjs';
import '../../../../modules/posts/components/new-post.js';

export const metadata = { title: 'New post — webjs blog' };

export default function NewPostPage() {
  return html`
    <style>
      .back {
        display: inline-block;
        margin-bottom: var(--sp-5);
        color: var(--fg-subtle);
        text-decoration: none;
        font: 500 11px/1 var(--font-mono);
        letter-spacing: 0.15em;
        text-transform: uppercase;
        transition: color var(--t-fast);
      }
      .back:hover { color: var(--fg); }
      .rubric {
        display: block;
        font: 600 11px/1 var(--font-mono);
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-3);
      }
      h1 {
        font-family: var(--font-serif);
        font-size: clamp(2rem, 1.5rem + 1.6vw, 2.6rem);
        line-height: 1.08;
        letter-spacing: -0.03em;
        font-weight: 700;
        margin: 0 0 var(--sp-6);
      }
    </style>
    <a class="back" href="/dashboard">← Dashboard</a>
    <span class="rubric">● compose</span>
    <h1>A new post.</h1>
    <new-post></new-post>
  `;
}
