import { WebComponent, html } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish-draft.server.ts';

/**
 * A bound submitter rendered by a COMPONENT (#1307).
 *
 * This is the case the old enclosing-form check could never resolve. SSR
 * renders a component's template in a SEPARATE pass, walking the
 * already-emitted HTML, so this template's scan has no view of the page that
 * placed the tag and cannot see whether the surrounding `<form>` bound
 * anything. The scan therefore had a third answer, cannot-tell, and had to
 * bind on it: refusing would have rejected a per-row button in a list, and a
 * refused component is ISOLATED at SSR, so production would have returned 200
 * with the button silently missing.
 *
 * Binding on cannot-tell is what produced the silent failure, because the
 * button then carried an identity with no way to send it as a POST.
 *
 * Nothing here asks about the form any more. The renderer gives this button
 * `formmethod="post"` and `formenctype="multipart/form-data"` alongside the
 * identity, so it submits correctly inside `/feedback/triage-split`'s unbound,
 * method-less form, with JavaScript on or off.
 *
 * The component itself is display-only, so elision drops its module from the
 * browser. That is the point rather than an oversight: the button is a plain
 * HTML submitter once SSR has run, and the no-JS e2e proves it needs no
 * script at all.
 */
class PublishButton extends WebComponent({}) {
  render() {
    return html`
      <button id="publish" formaction=${publishDraft} class="border rounded px-3 py-1">
        Publish
      </button>
    `;
  }
}
PublishButton.register('publish-button');
