import { html } from 'webjs';

export default function NotFound() {
  return html`
    <h1>404</h1>
    <p>Page not found.</p>
    <p><a href="/">← Home</a></p>
  `;
}
