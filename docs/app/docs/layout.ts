import { html } from 'webjs';
import '../../components/doc-shell.ts';

export default function DocsLayout({ children }: { children: unknown }) {
  return html`<doc-shell>${children}</doc-shell>`;
}
