import { html } from '@webjsdev/core';
import { saveDraft } from '#modules/feedback/actions/save-draft.server.ts';
import { publishDraft } from '#modules/feedback/actions/publish-draft.server.ts';

/**
 * Per-button server actions (#1207), the no-JS write path.
 *
 * The `<form>` binds `saveDraft`, and the Publish button overrides it with
 * `formaction=${publishDraft}`. Both are the same unquoted spelling, one level
 * apart, and neither needs a `method`, an enctype, or a dispatcher reading an
 * `intent` field.
 *
 * How it survives with JavaScript off: the renderer emits the form's identity
 * as a hidden first child and the button's as that button's own `name`/`value`
 * pair, which a browser submits only for the button that was pressed. Both
 * entries arrive, the submitter's last, and the dispatcher takes the last.
 */

type PageCtx = {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
};

export const metadata = { title: 'Triage - WebJs Blog' };

export default function TriagePage({ actionData }: PageCtx) {
  const err = actionData?.fieldErrors?.note;
  const val = actionData?.values?.note || '';
  return html`
    <div class="max-w-[460px] mt-6 mx-auto">
      <h1 class="font-serif text-2xl font-bold mb-4">Triage a note</h1>
      <form action=${saveDraft} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span>Note</span>
          <input id="note" name="note" type="text" value=${val} class="border rounded px-2 py-1">
        </label>
        ${err ? html`<p id="note-error" class="text-sm text-red-600">${err}</p>` : ''}
        <div class="flex gap-2">
          <button id="save" class="border rounded px-3 py-1">Save draft</button>
          <button id="publish" formaction=${publishDraft} class="border rounded px-3 py-1">Publish</button>
        </div>
      </form>
    </div>
  `;
}
