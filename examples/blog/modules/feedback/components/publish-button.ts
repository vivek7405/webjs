import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish-draft.server.ts';

/**
 * The submitter half of the CANNOT-TELL shape (#1307), split out of its form on
 * purpose.
 *
 * A component renders its own template in a separate pass with no view of the
 * host page, so when the renderer reaches this `formaction=${publishDraft}` it
 * cannot know whether the enclosing `<form>` binds an action. That is the
 * cannot-tell answer, and cannot-tell BINDS: refusing there would reject a
 * per-row button in a list and a button inside a component, both ordinary
 * shapes, and an SSR refusal is isolated per component, so production would
 * return 200 with this button silently gone.
 *
 * `/feedback/triage-split` renders this inside a form that IS bound, which is
 * the fallback working correctly. It is also the counterfactual for the whole
 * change: make cannot-tell refuse and this component renders empty, so the e2e
 * that submits this button with JavaScript off goes red.
 *
 * The mirror image, this button inside an UNBOUND form, is what
 * `webjs check`'s `submitter-needs-bound-form` rule exists to catch.
 */
class PublishButton extends WebComponent({}) {
  render() {
    return html`<button id="publish" formaction=${publishDraft} class="border rounded px-3 py-1">Publish</button>`;
  }
}
PublishButton.register('publish-button');
