import { html, type LayoutProps } from '@webjsdev/core';
import '#components/counter.ts';

export default function RootLayout({ children }: LayoutProps) {
  return html`
    <main>
      <counter-el></counter-el>
      ${children}
    </main>
  `;
}
