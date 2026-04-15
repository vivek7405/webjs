import { html } from 'webjs';
import '../components/error-card.ts';

/**
 * Root error boundary. Any uncaught error thrown while rendering a page
 * (or layout, or async hole) that isn't a `notFound()` or `redirect()`
 * sentinel lands here.
 *
 * @param {{ error: Error | unknown }} ctx
 */
export default function ErrorBoundary({ error }) {
  const message = error instanceof Error ? error.message : String(error);
  return html`<error-card message=${message}></error-card>`;
}
