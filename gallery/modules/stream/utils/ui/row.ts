// A feature-local VIEW FRAGMENT: pure, returns markup, used only by the stream
// demo. It lives in `modules/<feature>/utils/ui/` rather than `utils/` (which
// holds helpers returning DATA) or `components/` (which holds custom elements).
// See .agents/skills/webjs/references/styling.md.
//
// WHY a fragment and not a display-only <stream-row> element: an element is a
// tag in the DOM, and neither caller can carry one. The list wants a direct
// `<ul> > <li>` child, so a wrapper would break that selector and the list
// semantics; and <webjs-stream> takes its payload as an HTML STRING, which no
// component can return. That is the test, not bytes: where a wrapper element is
// harmless, reach for the component instead.
//
// Hence the two shapes below, off one class list, so the streamed row and the
// seeded rows cannot drift apart. That drift was live: the class list used to
// exist three times in this feature, once in a `rowCls` const and twice inlined
// in the component's own template, which did not use the const.
import { html } from '@webjsdev/core';

const ROW =
  'flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-[15px] text-foreground';

/** The row as a template, for the component's own render(). */
export function streamRow(id: string, label: unknown) {
  return html`<li id=${id} class=${ROW}>${label}</li>`;
}

/** The same row as an HTML string, for a <webjs-stream> template payload. */
export function streamRowHTML(id: string, label: string): string {
  return `<li id="${id}" class="${ROW}">${label}</li>`;
}
