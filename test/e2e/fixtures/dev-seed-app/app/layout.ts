import { html, type LayoutProps } from '@webjsdev/core';

export default function RootLayout({ children }: LayoutProps) {
  return html`<main>${children}</main>`;
}
