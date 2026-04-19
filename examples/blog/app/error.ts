import { html } from '@webjs/core';
import '../components/error-card.ts';

/**
 * Root error boundary. Any uncaught error thrown while rendering a page
 * (or layout, or async hole) that isn't a notFound() or redirect() sentinel
 * lands here.
 */
export default function ErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return html`<error-card message=${message}></error-card>`;
}
