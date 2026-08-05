import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Script swap · WebJs Blog',
  description: 'Pins that a top-level script in a swapped range re-executes on a soft navigation.',
};

/**
 * The children of the #1102 fixture layout. Deliberately plain: the assertion
 * lives on the layout's two sibling scripts, and this only needs to be the
 * content BETWEEN them so the range walk has something to cross.
 */
export default function ScriptSwap() {
  return html`
    <p class="text-muted-foreground max-w-[56ch] m-0" id="script-swap-body">
      The counters above are written by inline scripts the layout renders on
      either side of this paragraph.
    </p>
  `;
}
