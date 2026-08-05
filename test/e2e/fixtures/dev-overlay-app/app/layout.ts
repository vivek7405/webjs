import { html } from '@webjsdev/core';
import '#components/counter.ts';

export default function RootLayout({ children }: { children: unknown }) {
  return html`
    <main>
      <counter-el></counter-el>
      ${children}
    </main>
  `;
}
