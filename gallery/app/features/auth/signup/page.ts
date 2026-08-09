import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { inputClass } from '#components/ui/input.ts';
import { buttonClass } from '#components/ui/button.ts';
import { signup } from '#modules/auth/actions/signup.server.ts';

export const metadata = { title: 'Sign up' };

const inputCls = inputClass();

export default function SignupPage({ actionData }: { actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> } }) {
  const errors = actionData?.fieldErrors || {};
  const values = actionData?.values || {};
  return html`
    <div class="max-w-[420px] mx-auto">
      <h1 class="text-h2 font-bold mb-2">Create an account</h1>
      <p class="text-muted-foreground mb-5">Get started with your new workspace.</p>
      <!-- The form is bound to the action: no adapter, no fetch handler. With JS
           disabled this is a plain round-trip; with JS the client router swaps
           the 422 re-render (errors) or follows the 302 (success) in place. -->
      <form action=${signup} class="${cardClass()} grid gap-4 p-5">
        <div class="grid gap-1.5">
          <label for="name" class="text-[13px] font-medium text-muted-foreground">Name</label>
          <input id="name" name="name" type="text" value=${values.name || ''} required class=${inputCls} placeholder="Ada Lovelace" />
          ${errors.name ? html`<p class="m-0 text-[12.5px] text-destructive">${errors.name}</p>` : ''}
        </div>
        <div class="grid gap-1.5">
          <label for="email" class="text-[13px] font-medium text-muted-foreground">Email</label>
          <input id="email" name="email" type="email" value=${values.email || ''} required class=${inputCls} placeholder="ada@example.com" />
          ${errors.email ? html`<p class="m-0 text-[12.5px] text-destructive">${errors.email}</p>` : ''}
        </div>
        <div class="grid gap-1.5">
          <label for="password" class="text-[13px] font-medium text-muted-foreground">Password</label>
          <input id="password" name="password" type="password" minlength="8" required class=${inputCls} />
          ${errors.password ? html`<p class="m-0 text-[12.5px] text-destructive">${errors.password}</p>` : ''}
        </div>
        <button type="submit" class="${buttonClass()} justify-self-start">Create account</button>
      </form>
      <p class="text-sm text-muted-foreground mt-4">Already have an account? <a href="/features/auth/login" class="text-primary underline underline-offset-2">Log in</a></p>
    </div>
  `;
}
