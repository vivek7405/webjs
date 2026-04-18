import { html } from 'webjs';

export default function NotFound() {
  return html`
    <h1 class="font-serif text-display leading-[1.02] tracking-[-0.035em] font-bold m-0 mb-4">404</h1>
    <p class="text-lede text-fg-muted m-0 mb-4">Page not found.</p>
    <p class="m-0"><a href="/" class="text-accent underline underline-offset-[3px] decoration-transparent hover:decoration-current transition-colors duration-fast">← Home</a></p>
  `;
}
