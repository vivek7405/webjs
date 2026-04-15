import { html } from 'webjs';
import '../components/blog-shell.js';

/**
 * Root layout — wraps every page in the `<blog-shell>` chrome component.
 * All visual styling lives inside the component's shadow root.
 *
 * @param {{ children: unknown }} props
 */
export default function RootLayout({ children }) {
  return html`<blog-shell>${children}</blog-shell>`;
}
