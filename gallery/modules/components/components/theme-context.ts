// The context API: pass a value down to descendant components WITHOUT threading
// it through every level as an attribute. `createContext(name)` mints a typed
// key; a `ContextProvider` on an ancestor holds the value; a `ContextConsumer`
// on any descendant reads it (and, with `subscribe: true`, re-renders when it
// changes). Under the hood a consumer dispatches a `ContextRequestEvent` that
// bubbles up to the nearest provider, which is the low-level protocol the two
// controllers automate. All light DOM, so the provider's <slot> projects its
// children normally.
import { WebComponent, html, signal } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { createContext, ContextProvider, ContextConsumer, ContextRequestEvent } from '@webjsdev/core/context';

type Theme = 'light' | 'dark';

// One shared key. Descendants that read `themeContext` get the provider's value.
export const themeContext = createContext<Theme>('demo-theme');

export class ThemeProvider extends WebComponent {
  // The provider holds the value. setValue() pushes it to every subscribing
  // consumer in one shot.
  private provider = new ContextProvider<Theme>(this, { context: themeContext, initialValue: 'light' });

  private toggle() {
    this.provider.setValue(this.provider.value === 'light' ? 'dark' : 'light');
    this.requestUpdate(); // re-render the provider's own button label too
  }

  render() {
    return html`
      <div class=${cardClass('grid gap-3 p-3 max-w-[420px]')}>
        <button @click=${() => this.toggle()}
          class="${buttonClass({ size: 'sm' })} w-fit">
          provider theme: ${this.provider.value} (toggle)
        </button>
        <slot></slot>
      </div>
    `;
  }
}
ThemeProvider.register('theme-provider');

export class ThemeConsumer extends WebComponent {
  // subscribe: true re-renders this element whenever the provider calls setValue.
  private consumer = new ContextConsumer<Theme>(this, { context: themeContext, subscribe: true });
  private lastRead = signal<Theme | 'not read yet'>('not read yet');

  // The imperative escape hatch: dispatch a ContextRequestEvent yourself to
  // grab the current value ONCE without subscribing. It bubbles up to the
  // nearest provider, which answers via the callback.
  private readOnce() {
    this.dispatchEvent(
      new ContextRequestEvent<Theme>(themeContext, (value) => this.lastRead.set(value), false),
    );
  }

  render() {
    const theme = this.consumer.value ?? 'light';
    return html`
      <div class="flex items-center gap-3 text-[15px] text-foreground">
        <span>child sees: <strong>${theme}</strong></span>
        <button @click=${() => this.readOnce()}
          class=${buttonClass({ variant: 'secondary', size: 'xs' })}>read once</button>
        <span class="text-muted-foreground text-sm">last one-shot: ${this.lastRead.get()}</span>
      </div>
    `;
  }
}
ThemeConsumer.register('theme-consumer');
