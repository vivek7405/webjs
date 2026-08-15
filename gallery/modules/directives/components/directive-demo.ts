// The lit-html directive set WebJs re-exports (from '@webjsdev/core/directives').
// `repeat` keys a list so DOM nodes are REUSED across reorders instead of being
// recreated (use it for keyed lists that reorder; plain `.map()` is fine for
// static lists). `watch(signal)` does a fine-grained DOM swap of ONE node when
// the signal changes, without re-running the whole template. The second card
// shows more of the set: `live` (a controlled input), `ref` + `createRef` (a
// handle to a DOM node), `until` (a pending fallback for a promise),
// `unsafeHTML` (trusted raw HTML, NEVER user input), and `keyed` (force a fresh
// subtree when a key changes). The third card shows the rest: `guard` (skip a
// re-render when its deps are unchanged), `cache` (keep an inactive branch's
// DOM around while you toggle), `templateContent` (stamp an existing template's
// HTML), and `asyncAppend` / `asyncReplace` (stream values from an async
// iterable, appending each or replacing with the latest).
import { WebComponent, signal, html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cn } from '#lib/utils/cn.ts';
import { inputClass } from '#components/ui/input.ts';
import { repeat, watch, live, until, keyed, unsafeHTML, ref, createRef, guard, cache, templateContent, asyncAppend, asyncReplace } from '@webjsdev/core/directives';

interface Item { id: number; label: string }

let nextId = 4;

export class DirectiveDemo extends WebComponent {
  private items = signal<Item[]>([
    { id: 1, label: 'Alpha' },
    { id: 2, label: 'Bravo' },
    { id: 3, label: 'Charlie' },
  ]);
  private ticks = signal(0);
  // A controlled value (for `live`) and a key (for `keyed`).
  private text = signal('type here');
  private variant = signal(0);
  // A handle to the input node, attached by `ref` in the browser. A ref rather
  // than a `querySelector` because the template already owns the node, so the
  // handle flows out of `render()` instead of being re-found by a selector that
  // could match someone else's markup (or nothing at all after a rename).
  private inputRef = createRef<HTMLInputElement>();
  // Created ONCE (not per render), so `until` keeps the resolved value across
  // re-renders instead of flashing back to the fallback each time.
  private asyncValue: Promise<string> = this.later();
  // Which cached branch is showing (for `cache`), and a counter that lets us
  // prove `guard` skips its recompute unless its dep actually changes.
  private tab = signal<'a' | 'b'>('a');
  private guardBumps = signal(0);
  // Async iterables consumed on the client (both render empty at SSR). The
  // generators are lazy, so the field initializer just creates the iterator
  // without running the body. Both are FINITE and run ONCE: they animate on
  // first paint, then settle on their final value. restartStreams() swaps in
  // fresh iterables to replay them (a new iterable identity makes asyncAppend /
  // asyncReplace tear down and re-subscribe). streamRun is read in render() so
  // the swap triggers a re-render.
  private logIter: AsyncIterable<string> = this.log();
  private countIter: AsyncIterable<number> = this.countdown();
  private streamRun = signal(0);

  private restartStreams() {
    this.logIter = this.log();
    this.countIter = this.countdown();
    this.streamRun.set(this.streamRun.get() + 1);
  }
  // For `templateContent`: a real <template> element on the CLIENT (the client
  // directive clones its `.content`), and a plain { innerHTML } object at SSR
  // (there is no document to build a template with, and the server directive
  // emits innerHTML directly). The real template is built in connectedCallback,
  // which SSR never calls, so the two paths agree on the output.
  private stampTpl: HTMLTemplateElement | { innerHTML: string } = {
    innerHTML: '<strong>stamped</strong> from a template',
  };

  connectedCallback() {
    super.connectedCallback();
    const tpl = document.createElement('template');
    tpl.innerHTML = '<strong>stamped</strong> from a template';
    this.stampTpl = tpl;
  }

  // A finite async iterable: asyncAppend adds each line as it arrives.
  private async *log(): AsyncGenerator<string> {
    for (const line of ['connecting', 'authenticated', 'ready']) {
      await new Promise((r) => setTimeout(r, 500));
      yield line;
    }
  }
  // A finite async iterable: asyncReplace shows only the latest value, counting
  // down 5 -> 0 one step at a time.
  private async *countdown(): AsyncGenerator<number> {
    for (let n = 5; n >= 0; n--) {
      yield n;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private reverse() {
    this.items.set(this.items.get().slice().reverse());
  }
  private add() {
    const id = nextId++;
    this.items.set([...this.items.get(), { id, label: 'Item ' + id }]);
  }
  private focusInput() {
    this.inputRef.value?.focus();
  }
  // A promise that resolves after a tick, so `until` shows its fallback first.
  private later(): Promise<string> {
    return new Promise((resolve) => setTimeout(() => resolve('resolved!'), 400));
  }

  render() {
    const variant = this.variant.get();
    return html`
      <div class="grid gap-6 max-w-[420px]">
        <div class="grid gap-4">
          <div class="flex gap-2">
            <button @click=${() => this.reverse()}
              class=${buttonClass({ size: 'sm' })}>Reverse</button>
            <button @click=${() => this.add()}
              class=${buttonClass({ variant: 'secondary', size: 'sm' })}>Add</button>
          </div>
          <!-- repeat keyed by item.id: reversing reuses the existing <li> nodes. -->
          <ul class="grid gap-2 list-none m-0 p-0">
            ${repeat(this.items.get(), (it: Item) => it.id, (it: Item) => html`
              <li class="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-[15px] text-foreground">
                <span class="text-muted-foreground tabular-nums text-[13px]">#${it.id}</span>${it.label}
              </li>
            `)}
          </ul>
          <!-- watch(signal) swaps only this node when ticks changes. -->
          <button @click=${() => this.ticks.set(this.ticks.get() + 1)}
            class="${buttonClass({ variant: 'link', size: 'none' })} w-fit">ticks: ${watch(this.ticks)}</button>
        </div>

        <div class="grid gap-3 border-t border-border pt-4">
          <!-- live keeps the input's DOM value tracking the signal even after the
               user edits it, so it stays a controlled input. ref hands you the
               node via inputRef.value once it is attached in the browser. -->
          <div class="flex gap-2">
            <input
              ${ref(this.inputRef)}
              aria-label="Editable text for the ref focus demo"
              class=${inputClass('flex-1 min-w-0')}
              .value=${live(this.text.get())}
              @input=${(e: Event) => this.text.set((e.target as HTMLInputElement).value)}>
            <button @click=${() => this.focusInput()}
              class=${buttonClass({ variant: 'secondary', size: 'sm' })}>Focus</button>
          </div>
          <!-- until shows the fallback until the promise resolves. -->
          <p class="text-sm text-muted-foreground">async: ${until(this.asyncValue, 'loading...')}</p>
          <!-- keyed discards and rebuilds this subtree when the key changes;
               unsafeHTML injects trusted, author-written HTML (NEVER user input). -->
          <button @click=${() => this.variant.set(variant + 1)}
            class="${buttonClass({ variant: 'link', size: 'none' })} w-fit">rekey</button>
          ${keyed(variant, html`<div class="text-[15px] text-foreground">${unsafeHTML('<em>fresh subtree</em>')} #${variant}</div>`)}
        </div>

        <div class="grid gap-3 border-t border-border pt-4">
          <!-- guard([deps], fn) only re-runs fn when a dep changes. Bumping the
               guard counter re-renders it; the OTHER counter (ticks above) does
               not, so the guarded value stays put. -->
          <button @click=${() => this.guardBumps.set(this.guardBumps.get() + 1)}
            class="${buttonClass({ variant: 'link', size: 'none' })} w-fit">bump guard dep</button>
          <p class="text-sm text-foreground">guarded: ${guard([this.guardBumps.get()], () => html`computed at bump #${this.guardBumps.get()}`)}</p>

          <!-- cache(value) keeps the inactive tab's DOM alive while you toggle,
               so switching back is instant and preserves any element state. -->
          <!-- A tab toggle must keep a CONSTANT size between states, or the row
               reflows and the content below dances. So both tabs use ONE variant
               (same weight, border, padding) and cn() overrides only the active
               COLORS, never the box. -->
          <div class="flex gap-2">
            <button @click=${() => this.tab.set('a')}
              class=${cn(buttonClass({ variant: 'secondary', size: 'xs' }), this.tab.get() === 'a' && 'bg-primary text-primary-foreground border-primary hover:border-primary')}>Tab A</button>
            <button @click=${() => this.tab.set('b')}
              class=${cn(buttonClass({ variant: 'secondary', size: 'xs' }), this.tab.get() === 'b' && 'bg-primary text-primary-foreground border-primary hover:border-primary')}>Tab B</button>
          </div>
          <div class="text-[15px] text-foreground">${cache(
            this.tab.get() === 'a'
              ? html`<span>Panel A content</span>`
              : html`<span>Panel B content</span>`,
          )}</div>

          <!-- templateContent stamps a <template> element's content (see
               stampTpl: a real template on the client, a plain { innerHTML } at
               SSR, so first paint and hydration match). -->
          <div class="text-[15px] text-foreground">${templateContent(this.stampTpl)}</div>

          <!-- asyncAppend appends each value from an async iterable as it
               arrives; asyncReplace shows only the latest. Both render empty at
               SSR, stream in on the client, and finish (the log stops at
               "ready", the countdown at 0). Restart swaps in fresh iterables so
               you can watch them replay. The run counter forces the re-render. -->
          <div class="flex items-center gap-3">
            <button @click=${() => this.restartStreams()}
              class="${buttonClass({ variant: 'secondary', size: 'sm' })} w-fit">restart streams</button>
            <span class="text-sm text-muted-foreground">run #${this.streamRun.get()}</span>
          </div>
          <div class="text-sm text-muted-foreground">log (asyncAppend, one row per value):</div>
          <ul class="grid gap-1 list-none m-0 p-0 text-sm text-muted-foreground min-h-[1.25rem]">${asyncAppend(this.logIter, (line: string) => html`<li>· ${line}</li>`)}</ul>
          <p class="text-sm text-foreground">countdown (asyncReplace, latest value only): ${asyncReplace(this.countIter)}</p>
        </div>
      </div>
    `;
  }
}
DirectiveDemo.register('directive-demo');
