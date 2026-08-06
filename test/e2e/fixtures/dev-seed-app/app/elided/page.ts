import { html } from '@webjsdev/core';
import '#components/elided-card.ts';
import '#components/counter.ts';

export default function Page() {
  return html`
    <h1>elided</h1>
    <elided-card></elided-card>
    <counter-el></counter-el>
    <a id="to-home" href="/">home</a>
  `;
}
