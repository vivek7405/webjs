import { WebComponent, html } from '@webjsdev/core';

/**
 * `<like-button count="3">`: the flagship progressive-enhancement demo,
 * rendered live in the "What the browser receives" section so the site
 * dogfoods its own framework.
 *
 * SSR emits `<button>♥ 3</button>` from the `count` attribute, so it reads
 * and is styled with JavaScript off. On hydration the `@click` handler
 * upgrades it in place, so clicking actually increments the count. The
 * source is kept identical to the sample shown in the section's left
 * window, so the code on the page is the code that runs.
 *
 * The button is intentionally unstyled here; the page styles a bare
 * `like-button button` selector (tag-prefixed per the light-DOM rule),
 * which is also why the view-source stays clean.
 */
export class LikeButton extends WebComponent({ count: Number }) {
  render() {
    return html`<button @click=${() => this.count++}>
      ♥ ${this.count}
    </button>`;
  }
}

LikeButton.register('like-button');
