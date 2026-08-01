import { WebComponent, prop, html } from '@webjsdev/core';
import { submitFeedback } from '#modules/feedback/actions/submit-feedback.server.ts';

/**
 * A bound form inside a SHIPPING component (#1155).
 *
 * The plain `/feedback` page never hydrates, so its form is whatever SSR
 * emitted and the client renderer is never involved. This component is the
 * other half, and it is the shape the scaffold's todo gallery uses: it binds
 * `action=${submitFeedback}` AND carries interactivity, so it ships, hydrates,
 * and re-renders its whole template in the browser.
 *
 * The `rows` repeater is what makes the client half OBSERVABLE rather than
 * merely present. Hydrating the SSR'd form only PATCHES the markup the server
 * already sent, identity field included, so an assertion on it passes whether
 * or not the client reconcile ran. A row added in the browser has no SSR'd
 * markup to inherit: its form is built entirely by the client renderer, which
 * has to drop the `action` attribute, supply `method` / `enctype`, and build
 * the hidden identity field from the identity the GENERATED RPC stub stamps on
 * itself. If anything stopped the browser-served stub carrying that stamp, this
 * component's render would throw in the browser and the card would go blank,
 * while every node-side suite stayed green (they all hand-stamp a stand-in).
 *
 * The `@submit` handler only counts attempts; it does not preventDefault, so
 * every row submits through the normal path and works with JS off. With JS off
 * the repeater button does nothing and the SSR'd first row is the whole form,
 * which is the progressive-enhancement claim.
 */
class FeedbackForm extends WebComponent({
  rows: prop(Number, { state: true }),
  attempts: prop(Number, { state: true }),
  error: prop(String),
  value: prop(String),
}) {
  constructor() {
    super();
    this.rows = 1;
    this.attempts = 0;
    this.error = '';
    this.value = '';
  }

  formRow(i: number) {
    return html`
      <form action=${submitFeedback} class="flex flex-col gap-3" @submit=${() => { this.attempts += 1; }}>
        <label class="flex flex-col gap-1">
          <span>Email</span>
          <input
            id=${i === 0 ? 'live-email' : `live-email-${i}`}
            name="email"
            type="email"
            value=${i === 0 ? this.value : ''}
            class="border rounded px-2 py-1"
          >
        </label>
        ${i === 0 && this.error ? html`<p id="live-email-error" class="text-sm text-red-600">${this.error}</p>` : ''}
        <button type="submit" class="border rounded px-3 py-1">Submit</button>
      </form>
    `;
  }

  render() {
    return html`
      ${Array.from({ length: this.rows }, (_, i) => this.formRow(i))}
      <button id="live-add" type="button" @click=${() => { this.rows += 1; }}>Add another</button>
      <span id="live-attempts">${this.attempts}</span>
    `;
  }
}
FeedbackForm.register('feedback-form');
