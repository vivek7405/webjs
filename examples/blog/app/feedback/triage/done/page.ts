import { html } from '@webjsdev/core';

export const metadata = { title: 'Triaged - WebJs Blog' };

/**
 * PRG target for `/feedback/triage` (#1207 e2e fixture).
 *
 * The `ran` search param names which action actually ran, which is the thing
 * the per-button binding exists to make different. A redirect that only said
 * "it worked" could not tell `saveDraft` from `publishDraft`, so the e2e would
 * pass with the submitter binding removed entirely.
 */
export default function TriageDonePage({ searchParams }: { searchParams: { ran?: string } }) {
  return html`
    <div class="max-w-[460px] mt-6 mx-auto">
      <h1 id="ran" class="font-serif text-2xl font-bold">${searchParams?.ran || 'unknown'}</h1>
    </div>
  `;
}
