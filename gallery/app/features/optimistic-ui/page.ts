import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/optimistic-ui/components/like-button.ts';

export const metadata: Metadata = { title: 'Optimistic UI (imperative flip) | features' };

export default function OptimisticUiFeature() {
  return html`
    ${pageHeading('Optimistic UI')}
    ${lede(html`The imperative <code>optimistic(signal, value, action)</code> form: the UI flips instantly and rolls back if the action fails. For the declarative list form (add / remove with rollback) in a full app, see <a class="text-primary underline underline-offset-2" href="/examples/todo">/examples/todo</a>.`)}
    <like-button></like-button>
  `;
}
