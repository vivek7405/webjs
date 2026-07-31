import { html } from '@webjsdev/core';
import { submitFeedback } from '#modules/feedback/actions/submit-feedback.server.ts';

/**
 * The no-JS form write path (#1155), bound straight to a module action.
 *
 * `action=${submitFeedback}` is the whole wiring: the renderer omits the
 * attribute so the form posts to this page's own url, and emits the hidden
 * field that names the action. The page never mentions the transport.
 */

type PageCtx = {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
};

export const metadata = { title: 'Feedback - WebJs Blog' };

export default function FeedbackPage({ actionData }: PageCtx) {
  const err = actionData?.fieldErrors?.email;
  const val = actionData?.values?.email || '';
  return html`
    <div class="max-w-[460px] mt-6 mx-auto">
      <h1 class="font-serif text-2xl font-bold mb-4">Send feedback</h1>
      <form action=${submitFeedback} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span>Email</span>
          <input id="email" name="email" type="email" value=${val} class="border rounded px-2 py-1">
        </label>
        ${err ? html`<p id="email-error" class="text-sm text-red-600">${err}</p>` : ''}
        <button type="submit" class="border rounded px-3 py-1">Submit</button>
      </form>
    </div>
  `;
}
