import { html } from '@webjsdev/core';
import '#modules/feedback/components/feedback-form.ts';

/**
 * The same bound action as `/feedback`, but inside a SHIPPING component.
 *
 * `/feedback` is a plain page: it never hydrates, so the client renderer never
 * touches its form. This route is the hydrated counterpart, which is where the
 * client half of the binding actually runs (see `feedback-form.ts`).
 */

type PageCtx = {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
};

export const metadata = { title: 'Live feedback - WebJs Blog' };

export default function LiveFeedbackPage({ actionData }: PageCtx) {
  return html`
    <div class="max-w-[460px] mt-6 mx-auto">
      <h1 class="font-serif text-2xl font-bold mb-4">Send feedback (hydrated)</h1>
      <feedback-form
        .error=${actionData?.fieldErrors?.email || ''}
        .value=${actionData?.values?.email || ''}
      ></feedback-form>
    </div>
  `;
}
