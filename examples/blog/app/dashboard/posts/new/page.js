import { html } from 'webjs';
import '../../../../modules/posts/components/new-post.js';

export const metadata = { title: 'New post — webjs blog' };

export default function NewPostPage() {
  return html`
    <style>
      .back {
        display: inline-block;
        color: var(--fg-muted);
        text-decoration: none;
        font-size: 13px;
        margin-bottom: var(--sp-4);
      }
      .back:hover { color: var(--fg); }
    </style>
    <a class="back" href="/dashboard">← Dashboard</a>
    <h1>Write a new post</h1>
    <new-post></new-post>
  `;
}
