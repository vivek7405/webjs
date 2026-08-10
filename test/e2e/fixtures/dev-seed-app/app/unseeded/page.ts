import { html } from '@webjsdev/core';
import '#components/unseeded-card.ts';

export default function Page() {
  return html`<h1>unseeded</h1><unseeded-card tid="1"></unseeded-card>`;
}
