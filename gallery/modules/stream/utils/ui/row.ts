// A feature-local VIEW FRAGMENT: pure, returns markup, used only by the stream
// demo. It lives in `modules/<feature>/utils/ui/` rather than `utils/` (which
// holds helpers returning DATA) or `components/` (which holds custom elements).
// See .agents/skills/webjs/references/styling.md.
//
// The row exists in two shapes because <webjs-stream> carries its payload as an
// HTML STRING while the component's own template wants a TemplateResult. Both
// come off one class list here, so the streamed row and the initial rows cannot
// drift apart, which is exactly what the three scattered copies used to allow.
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
