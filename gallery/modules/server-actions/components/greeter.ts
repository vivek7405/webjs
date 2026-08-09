// Calls the 'use server' action via a normal import (the RPC stub). Never
// hand-write fetch(); importing the action IS the API.
import { WebComponent, signal, html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { buttonClass } from '#components/ui/button.ts';
import { bareInputClass } from '#components/ui/input.ts';
import { greet } from '../actions/greet.server.ts';

export class Greeter extends WebComponent {
  private msg = signal('');

  async run(e: SubmitEvent) {
    e.preventDefault();
    const name = String(new FormData(e.target as HTMLFormElement).get('name') ?? '');
    // The action's requireAuth middleware reads the real session off the request.
    // Signed out, this comes back as a 401 failure envelope ("Sign in to
    // continue."); sign in at /features/auth/login and the greeting succeeds.
    const r = await greet({ name });
    // Narrow on r.success so TS knows `data` (success) vs `error` (failure). A
    // middleware short-circuit arrives here as a normal failure envelope.
    this.msg.set(r.success ? (r.data?.message ?? '') : (r.error ?? 'error'));
  }
  render() {
    return html`
      <div class="grid gap-3 max-w-[420px]">
        <form @submit=${(e: SubmitEvent) => this.run(e)}
          class="${cardClass()} flex items-center gap-2 p-2 pl-4">
          <input name="name" placeholder="your name" autocomplete="off"
            class=${bareInputClass()} />
          <button type="submit"
            class="${buttonClass()} shrink-0">Greet</button>
        </form>
        <p class="m-0 text-sm text-muted-foreground">The action is gated by requireAuth. <a class="text-primary underline underline-offset-2" href="/features/auth/login">Sign in</a> to greet; signed out returns a real 401.</p>
        ${this.msg.get() ? html`<p class="m-0 font-semibold text-foreground">${this.msg.get()}</p>` : ''}
      </div>
    `;
  }
}
Greeter.register('server-greeter');
