// The IMPERATIVE optimistic() form for a simple flip: set the signal to the new
// value instantly, run the action, and roll back automatically if it rejects.
// Use optimistic UI where the client can PREDICT the result (likes, toggles,
// reorders, renames). Skip it where it hurts: unpredictable / server-computed
// results, side-effectful or OAuth / payment mutations, and destructive
// irreversible actions (confirm-first is better there).
//
// This is the simple-flip API. For a LIST mutation (add / remove with rollback)
// see the declarative optimistic(host, { source, update }) + .add() form in the
// /examples/todo app.
import { WebComponent, signal, optimistic, html } from '@webjsdev/core';
import { cn } from '#lib/utils/cn.ts';
import { buttonClass } from '#components/ui/button.ts';
import { likePost } from '../actions/like-post.server.ts';

export class LikeButton extends WebComponent {
  private liked = signal(false);

  private async toggle() {
    const next = !this.liked.get();
    // optimistic(signal, value, action) flips `liked` to `next` immediately,
    // runs the action, and restores the old value if the action rejects.
    await optimistic(this.liked, next, () => likePost({ liked: next }));
  }

  render() {
    const liked = this.liked.get();
    // Build ON the design system, do not re-implement it. The like toggle IS the
    // button variants: unliked reads as `secondary` (card surface), liked as
    // `default` (primary fill). So compose buttonClass() for the base + colors +
    // focus ring + cursor, then override only the genuinely bespoke bits with cn()
    // (which tailwind-merges): a pill radius over the helper's rounded-xl, and a
    // border on the liked state. The border is GEOMETRY, not decoration: the
    // `secondary` variant carries a 1px border and `default` carries none, so under
    // box-sizing border-box an auto-width inline-flex button would change its outer
    // size by ~1px each toggle (a small label jitter). Re-adding `border
    // border-primary` keeps a 1px border in both states so the pill stays put. On
    // the primary fill that border color matches the fill, so it reads as invisible,
    // doing only the no-jitter job. Only the heart SVG stays fully custom.
    return html`
      <button @click=${() => this.toggle()} aria-pressed=${liked ? 'true' : 'false'}
        class=${cn(
          buttonClass({ variant: liked ? 'default' : 'secondary' }),
          'rounded-full',
          liked && 'border border-primary',
        )}>
        <svg viewBox="0 0 24 24" class="w-4 h-4 ${liked ? 'fill-current stroke-none' : 'fill-none stroke-current'}" style="stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
        ${liked ? 'Liked' : 'Like'}
      </button>
    `;
  }
}
LikeButton.register('like-button');
