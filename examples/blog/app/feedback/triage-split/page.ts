import { html } from '@webjsdev/core';
import { saveDraft } from '#modules/feedback/actions/save-draft.server.ts';
import '#modules/feedback/components/publish-button.ts';

/**
 * The #1307 shape, as an e2e fixture: a COMPLETELY UNBOUND form whose buttons
 * each bind their own action.
 *
 * Note what this `<form>` does NOT have. No `action=${...}`, so it binds
 * nothing. No `method`, so a browser would default it to GET. Before #1307
 * that was the silent failure: the renderer refused a bound submitter where it
 * could see the form was unbound, and bound one anyway where it could not see
 * (a button inside a component, which is the ordinary shape). The latter
 * submitted as a GET, put the identity in the query string, re-rendered this
 * page, and ran nothing. A 200 with no log and no visible symptom.
 *
 * It works now because a bound submitter carries its whole submission: the
 * renderer puts `formmethod="post"` and `formenctype="multipart/form-data"` on
 * the button itself, alongside the identity, so the button needs nothing from
 * the form around it.
 *
 * Both shapes are here on purpose, because they exercise different renderer
 * paths. "Save draft" is written INLINE in this page's template, which SSR
 * scans in one pass. "Publish" is rendered by `<publish-button>`, a COMPONENT,
 * whose template SSR renders in a separate pass with no view of this page.
 * That second one is the case no scan could ever resolve, and it is why the
 * fix had to remove the question rather than answer it better.
 *
 * `/feedback/triage` keeps the bound-form-plus-bound-submitter shape, so the
 * two routes together cover a bound and an unbound host form.
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
      <form class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span>Note</span>
          <input id="note" name="note" type="text" value=${val} class="border rounded px-2 py-1">
        </label>
        ${err ? html`<p id="note-error" class="text-sm text-red-600">${err}</p>` : ''}
        <div class="flex gap-2">
          <button id="save" formaction=${saveDraft} class="border rounded px-3 py-1">Save draft</button>
          <publish-button></publish-button>
        </div>
      </form>
    </div>
  `;
}
