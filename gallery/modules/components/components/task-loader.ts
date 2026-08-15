// `Task` runs an async function and exposes its state (via `TaskStatus`:
// INITIAL / PENDING / COMPLETE / ERROR) so render() can show a spinner, the
// value, or an error without hand-rolling the bookkeeping. Use it for
// genuinely CLIENT-only async data (a browser-driven fetch, a retry-on-click
// load). For request-time server data that should be in the first paint, prefer
// `async render()` instead, which blocks SSR so the data is server-rendered;
// a Task shows its PENDING state at SSR, so the value is not in the first paint.
import { WebComponent, html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { Task, TaskStatus } from '@webjsdev/core/task';

export class TaskLoader extends WebComponent {
  // Bumped on each reload so args change and the task re-runs.
  private attempt = 0;

  // Task calls task(...args(), { signal }), so the args() array is SPREAD into
  // positional parameters (not passed as one array). One arg here, so read it
  // directly as `attempt`.
  private task = new Task<string>(this, {
    task: async (attempt: number) => {
      await new Promise((r) => setTimeout(r, 600));
      if (attempt % 3 === 2) throw new Error('unlucky attempt');
      return `loaded on attempt #${attempt}`;
    },
    args: () => [this.attempt],
  });

  private reload() {
    this.attempt += 1;
    this.task.run();
  }

  render() {
    const t = this.task;
    const body =
      t.status === TaskStatus.PENDING ? html`<span class="text-muted-foreground">loading…</span>`
      : t.status === TaskStatus.ERROR ? html`<span class="text-destructive">error: ${String((t.error as Error)?.message ?? t.error)}</span>`
      : t.status === TaskStatus.COMPLETE ? html`<span class="text-foreground">${t.value}</span>`
      : html`<span class="text-muted-foreground">idle</span>`;
    return html`
      <div class="flex items-center gap-3 text-[15px]">
        <button @click=${() => this.reload()}
          class=${buttonClass({ variant: 'secondary', size: 'sm' })}>reload</button>
        ${body}
      </div>
    `;
  }
}
TaskLoader.register('task-loader');
