import { WebComponent, prop, html } from '@webjsdev/core';
import { submitFeedback } from '#modules/feedback/actions/submit-feedback.server.ts';

/**
 * A bound form inside a SHIPPING component (#1155).
 *
 * The plain `/feedback` page never hydrates, so its form is whatever SSR
 * emitted and the client renderer is never involved. This component is the
 * other half, and it is the shape the scaffold's todo gallery uses: it binds
 * `action=${submitFeedback}` AND carries an `@submit` handler, so it ships,
 * hydrates, and re-renders its whole template in the browser.
 *
 * That re-render is where the client has to reproduce what SSR emitted: drop
 * the `action` attribute, supply `method` / `enctype`, and rebuild the hidden
 * identity field from the identity the GENERATED RPC stub stamps on itself. If
 * anything stopped the browser-served stub carrying that stamp, the component's
 * render would throw in the browser and the card would go blank, while every
 * node-side suite stayed green (they all hand-stamp a stand-in).
 *
 * The `@submit` handler only counts attempts; it does not preventDefault, so
 * the submission proceeds through the normal path and the form still works
 * with JS off.
 */
class FeedbackForm extends WebComponent({
  attempts: prop(Number, { state: true }),
  error: prop(String),
  value: prop(String),
}) {
  constructor() {
    super();
    this.attempts = 0;
    this.error = '';
    this.value = '';
  }

  render() {
    return html`
      <form action=${submitFeedback} class="flex flex-col gap-3" @submit=${() => { this.attempts += 1; }}>
        <label class="flex flex-col gap-1">
          <span>Email</span>
          <input id="live-email" name="email" type="email" value=${this.value} class="border rounded px-2 py-1">
        </label>
        ${this.error ? html`<p id="live-email-error" class="text-sm text-red-600">${this.error}</p>` : ''}
        <button type="submit" class="border rounded px-3 py-1">Submit</button>
        <span id="live-attempts">${this.attempts}</span>
      </form>
    `;
  }
}
FeedbackForm.register('feedback-form');
