// Consumes a streaming action at the call site with `for await`. The import of
// a `'use server'` action is rewritten to an RPC stub, so `await streamTokens()`
// resolves to an async iterable whose chunks arrive as the server yields them.
// We append each chunk to an instance signal, so the text builds up live as it
// streams (the built-in SignalWatcher re-renders on each `.set`). With JS off
// the button is inert and the empty output renders (streaming is inherently a
// JS behaviour), so nothing here breaks the no-JS first paint.
import { WebComponent, signal, html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { buttonClass } from '#components/ui/button.ts';
import { streamTokens } from '../actions/stream-tokens.server.ts';

export class TokenStream extends WebComponent {
  // Plain instance signals (not reactive props), so a class field is fine here.
  private output = signal('');
  private busy = signal(false);

  private async run() {
    this.output.set('');
    this.busy.set(true);
    try {
      // `await streamTokens(...)` gives the async iterable; `for await` pulls
      // each token as it arrives instead of waiting for the whole response.
      for await (const chunk of await streamTokens('webjs')) {
        this.output.set(this.output.get() + chunk);
      }
    } finally {
      this.busy.set(false);
    }
  }

  render() {
    const busy = this.busy.get();
    const output = this.output.get();
    // Only reserve the output area once streaming starts (or has produced text),
    // so an idle demo has no empty box below the button.
    return html`
      <div class="${cardClass()} p-5">
        <button
          @click=${() => this.run()}
          ?disabled=${busy}
          class=${buttonClass()}
        >
          ${busy ? 'streaming…' : 'Stream tokens'}
        </button>
        ${busy || output
          ? html`<pre class="mt-4 whitespace-pre-wrap font-mono text-sm text-foreground">${output}</pre>`
          : ''}
      </div>
    `;
  }
}
TokenStream.register('token-stream');
