import { html } from 'webjs';
import '../../../../components/new-post.js';

export const metadata = { title: 'New post — webjs blog' };

export default function NewPostPage() {
  return html`
    <p><a href="/dashboard">← Dashboard</a></p>
    <h1>New post</h1>
    <new-post></new-post>
  `;
}
