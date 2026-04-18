import { html } from 'webjs';
import '../../../../modules/posts/components/new-post.ts';
import { backLink, rubric, clampH1 } from '../../../_utils/ui.ts';

export const metadata = { title: 'New post — webjs blog' };

export default function NewPostPage() {
  return html`
    ${backLink('/dashboard', 'Dashboard', 'sm')}
    ${rubric('compose', 'sm')}
    ${clampH1('A new post.')}
    <new-post></new-post>
  `;
}
