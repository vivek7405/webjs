import { html } from '@webjsdev/core';
import { saveDraft } from '#modules/feedback/actions/save-draft.server.ts';
import '#modules/feedback/components/publish-button.ts';

/**
 * The same page as `/feedback/triage`, with the Publish button moved into a
 * component (#1307).
 *
 * `/feedback/triage` keeps the form and the submitter in ONE template, so the
 * renderer resolves boundness in a single scan and the cannot-tell path is
 * never taken. This route is the other half: the form is bound here and the
 * submitter is bound one module over, which is the shape SSR cannot judge in
 * one pass and therefore binds on faith.
 *
 * It is dogfood coverage and an e2e fixture at once. With JavaScript off the
 * served markup must still carry the component-rendered button's
 * `name="__webjs_action"` and its `<hash>/publishDraft` value, and a native
 * submit must run the action. If the cannot-tell fallback were ever made to
 * refuse, the component would render empty (SSR component errors are isolated),
 * the button would not be in the DOM at all, and that e2e would fail.
 */

type PageCtx = {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
};

export const metadata = { title: 'Triage (split) - WebJs Blog' };

export default function TriageSplitPage({ actionData }: PageCtx) {
  const err = actionData?.fieldErrors?.note;
  const val = actionData?.values?.note || '';
  return html`
    <div class="max-w-[460px] mt-6 mx-auto">
      <h1 class="font-serif text-2xl font-bold mb-4">Triage a note (split)</h1>
      <form action=${saveDraft} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span>Note</span>
          <input id="note" name="note" type="text" value=${val} class="border rounded px-2 py-1">
        </label>
        ${err ? html`<p id="note-error" class="text-sm text-red-600">${err}</p>` : ''}
        <div class="flex gap-2">
          <button id="save" class="border rounded px-3 py-1">Save draft</button>
          <publish-button></publish-button>
        </div>
      </form>
    </div>
  `;
}
