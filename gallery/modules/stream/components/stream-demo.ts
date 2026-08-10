// <webjs-stream> is the element-level DOM-update grammar (#248): a self-applying
// element that clones its <template> and runs one native DOM method against a
// target (by id), then removes itself. `renderStream(htmlString)` from
// @webjsdev/core applies such a payload on the client. It is WebJs's take on
// Turbo Streams: surgical append / prepend / replace / update / remove, without
// redrawing a whole region.
//
// This demo drives it from the client with buttons. The list below is seeded
// ONCE in render(); every button mutates the LIVE DOM via renderStream() and the
// component never re-renders (the row counter is a plain field, deliberately not
// a signal, so reading it never re-runs render() and wipes the surgical updates).
// That is the whole point: out-of-band updates that a signal re-render or a frame
// region-swap would clobber.
import { WebComponent, html, renderStream } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';

// Build a <webjs-stream> payload string. It is a plain string (NOT an html``
// template), so interpolating the row markup here is fine. `remove` needs no
// <template>; every other action wraps its content in one.
function streamPayload(action: string, target: string, inner = '') {
  const body = action === 'remove' ? '' : `<template>${inner}</template>`;
  return `<webjs-stream action="${action}" target="${target}">${body}</webjs-stream>`;
}

const rowCls = 'flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-[15px] text-foreground';
const row = (id: string, label: string) => `<li id="${id}" class="${rowCls}">${label}</li>`;

export class StreamDemo extends WebComponent {
  // A plain instance field, NOT a signal: incremented to mint unique row ids.
  // It is never read inside render(), so appending a row does not re-render the
  // component and blow away the streamed-in rows.
  #n = 2;

  // NOTE the method names: NOT append() / prepend(). Those are native
  // ParentNode methods, and WebJs instruments them on every light-DOM host for
  // the slot API (#1021), so a component method of the same name is shadowed and
  // never runs. Name your handlers something else (see muscle-memory-gotchas).
  appendRow() {
    this.#n++;
    renderStream(streamPayload('append', 'stream-list', row(`row-${this.#n}`, `Row ${this.#n} (appended)`)));
  }
  prependRow() {
    this.#n++;
    renderStream(streamPayload('prepend', 'stream-list', row(`row-${this.#n}`, `Row ${this.#n} (prepended)`)));
  }
  replaceFirst() {
    // `replace` swaps the target element itself. The replacement keeps id row-1,
    // so the button stays repeatable.
    renderStream(streamPayload('replace', 'row-1', row('row-1', 'Row 1 (replaced)')));
  }
  removeSecond() {
    // `remove` deletes the target and needs no <template>.
    renderStream(streamPayload('remove', 'row-2'));
  }
  reset() {
    // `update` replaces the target's children, restoring the seed list.
    renderStream(streamPayload('update', 'stream-list', row('row-1', 'Row 1') + row('row-2', 'Row 2')));
  }

  render() {
    const btn = buttonClass({ variant: 'secondary', size: 'xs' });
    return html`
      <div class="grid gap-4 max-w-[460px]">
        <div class="flex flex-wrap gap-2">
          <button class=${btn} @click=${() => this.appendRow()}>Append</button>
          <button class=${btn} @click=${() => this.prependRow()}>Prepend</button>
          <button class=${btn} @click=${() => this.replaceFirst()}>Replace Row 1</button>
          <button class=${btn} @click=${() => this.removeSecond()}>Remove Row 2</button>
          <button class=${btn} @click=${() => this.reset()}>Reset</button>
        </div>
        <!-- The target list. renderStream() mutates it by id; this markup renders
             once and is never re-rendered by the component. -->
        <ul id="stream-list" class="grid gap-2 m-0 p-0 list-none">
          <li id="row-1" class="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-[15px] text-foreground">Row 1</li>
          <li id="row-2" class="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-[15px] text-foreground">Row 2</li>
        </ul>
      </div>
    `;
  }
}
StreamDemo.register('stream-demo');
