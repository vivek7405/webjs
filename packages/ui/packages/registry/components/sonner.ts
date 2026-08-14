/**
 * Sonner: toast notification queue. Tier-2. Hand-rolled (no `sonner`
 * npm dependency); ships as a single `<ui-sonner>` viewport you mount
 * once + an imperative `toast()` API published as a module export. A
 * singleton bus routes new toasts to the most recently connected
 * viewport; multiple `<ui-sonner>` instances are supported with
 * explicit per-instance dispatch.
 *
 * shadcn parity:
 *   <Toaster />     → <ui-sonner position>
 *   toast(msg, opts)
 *                   → toast()  (plus toast.success / .error / .info / .warning /
 *                     .loading / .promise / .dismiss)
 *
 * Attributes on <ui-sonner>:
 *   `position`: "top-left" | "top-center" | "top-right" |
 *               "bottom-left" | "bottom-center" | "bottom-right" (default).
 *
 * Per-toast options (passed as the second arg to `toast(msg, opts)`):
 *   `id`:          string | number. Stable id so repeated calls update in place.
 *   `description`: string. Secondary line under the title.
 *   `duration`:    ms, default 4000 (loading toasts default to 0, no auto-dismiss).
 *   `action`:      { label, onClick } | undefined. Renders an action button.
 *   `cancel`:      { label, onClick } | undefined. Renders a cancel button.
 *                  Both buttons dismiss the toast after running their onClick.
 *
 * Events: none dispatched (consumers act on the id returned by `toast()`).
 *
 * Programmatic API on <ui-sonner>: `.addToast(message, opts, type)` for
 * per-instance dispatch (bypasses the singleton router that `toast()`
 * uses); typically only needed when mounting multiple viewports.
 *
 * A11y (owned by the element, nothing to supply):
 *   The viewport is a persistent `aria-live="polite"` region labelled
 *   "Notifications", so a toast is announced as it is inserted, and it is the
 *   ONLY live root an ordinary toast resolves under: a non-error toast carries
 *   no role of its own, because `role="status"` is itself a live region and
 *   nesting one inside the polite viewport bought nothing while making some
 *   readers announce the toast twice. An `error` toast does carry
 *   `role="alert"` so it is announced assertively, which is the only way to
 *   make one item assertive inside a polite viewport, and its second live
 *   root is the accepted cost of that urgency. Every toast
 *   also ships a labelled close button, so a toast can always be dismissed by
 *   hand rather than only by its timer or a programmatic `toast.dismiss(id)`.
 *   That matters most for a toast that never auto-dismisses, which
 *   `toast.loading()` is by default (`duration: 0`) and which was otherwise
 *   impossible to get rid of from the UI. Each toast's icon is decorative and
 *   aria-hidden; the meaning is in the text and the role.
 *
 * Design tokens used: --popover, --popover-foreground, --border, --radius.
 *
 * @example
 * ```html
 * <!-- Mount once at the root of your app, typically in layout.ts. -->
 * <ui-sonner position="bottom-right"></ui-sonner>
 *
 * <!-- Then from anywhere, in a server or client component, call the API. -->
 * <script type="module">
 *   import { toast } from '@/components/ui/sonner.ts';
 *   toast('Saved!');
 *   toast.success('Account created');
 *   toast.error('Failed to save', { description: 'Try again' });
 *   toast.promise(savePost(), { loading: 'Saving', success: 'Saved', error: 'Failed' });
 *   toast.dismiss(id);
 *
 *   // action and cancel buttons; each dismisses the toast after its onClick.
 *   toast('Post deleted', {
 *     action: { label: 'Undo', onClick: () => restorePost() },
 *     cancel: { label: 'Dismiss', onClick: () => {} },
 *   });
 * </script>
 * ```
 */
import { WebComponent, html, repeat, unsafeHTML, signal, prop } from '@webjsdev/core';
import { onBeforeCache } from '../lib/dom.ts';

type ToastType = 'default' | 'success' | 'error' | 'info' | 'warning' | 'loading';

interface ToastOptions {
  id?: string | number;
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  cancel?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: string | number;
  type: ToastType;
  message: string;
}

let nextId = 1;

interface ToastBus {
  add(t: ToastItem): void;
  remove(id: string | number): void;
}

// The toast bus lives on `globalThis`, NOT in module scope, so the global
// `toast()` still reaches a mounted <ui-sonner> when the module is loaded
// under two different URLs. The app registers the element from the
// version-hashed `sonner.ts?v=<hash>` (asset-hash, #243), while a caller may
// do a bare `import('/components/ui/sonner.ts')`: those are distinct module
// instances with distinct module-scope state, but they share one `window`.
// Last-mounted viewport wins (it overwrites `bus().add`), matching the prior
// singleton semantics. Without this, toasts published from a different module
// instance silently went to a no-op bus (#745).
function bus(): ToastBus {
  const g = globalThis as unknown as { __webjsSonnerBus?: ToastBus };
  return (g.__webjsSonnerBus ??= { add() {}, remove() {} });
}

function publish(item: ToastItem): string | number {
  bus().add(item);
  return item.id;
}

function makeToast(message: string, opts: ToastOptions = {}, type: ToastType = 'default'): string | number {
  return publish({
    id: opts.id ?? nextId++,
    type,
    message,
    description: opts.description,
    duration: opts.duration ?? (type === 'loading' ? 0 : 4000),
    action: opts.action,
    cancel: opts.cancel,
  });
}

export function toast(message: string, opts?: ToastOptions): string | number {
  return makeToast(message, opts, 'default');
}
toast.success = (msg: string, o?: ToastOptions) => makeToast(msg, o, 'success');
toast.error = (msg: string, o?: ToastOptions) => makeToast(msg, o, 'error');
toast.info = (msg: string, o?: ToastOptions) => makeToast(msg, o, 'info');
toast.warning = (msg: string, o?: ToastOptions) => makeToast(msg, o, 'warning');
toast.loading = (msg: string, o?: ToastOptions) => makeToast(msg, o, 'loading');
toast.dismiss = (id?: string | number) => {
  if (id == null) return;
  bus().remove(id);
};
toast.promise = <T,>(p: Promise<T>, opts: { loading: string; success: string; error: string }) => {
  const id = toast.loading(opts.loading);
  p.then(() => {
    toast.dismiss(id);
    toast.success(opts.success);
  }).catch(() => {
    toast.dismiss(id);
    toast.error(opts.error);
  });
  return id;
};

// --------------------------------------------------------------------------
// <ui-sonner> renders pending toasts. No user-projected children, so no
// <slot>: the toaster owns its content entirely via render().
// --------------------------------------------------------------------------

const POSITIONS = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
} as const;

export type SonnerPosition = keyof typeof POSITIONS;

const TOAST_ITEM_BASE =
  'pointer-events-auto flex w-80 items-start gap-3 rounded-md border bg-popover p-4 text-sm text-popover-foreground shadow-md transition-all';

const TYPE_ICON_COLOR: Record<ToastType, string> = {
  default: 'text-foreground',
  success: 'text-emerald-500',
  error: 'text-destructive',
  info: 'text-sky-500',
  warning: 'text-amber-500',
  loading: 'text-muted-foreground',
};

export class UiSonner extends WebComponent({
  position: prop<SonnerPosition>(String, { reflect: true }),
}) {
  items = signal<ToastItem[]>([]);

  _disposeBeforeCache?: () => void;

  constructor() {
    super();
    this.position = 'bottom-right';
  }

  connectedCallback(): void {
    super.connectedCallback?.();
    // Clear pending toasts before a back/forward snapshot so a restored page
    // does not show stale toasts that should have auto-dismissed (#766).
    this._disposeBeforeCache = onBeforeCache(() => this.items.set([]));
  }

  disconnectedCallback(): void {
    this._disposeBeforeCache?.();
    super.disconnectedCallback?.();
  }

  // Routing the global toast() function to this viewport. Runs in
  // firstUpdated rather than the constructor because tests can mount
  // multiple <ui-sonner> instances and the most recently mounted wins
  // (matches the existing semantics). The bus lives on globalThis so this
  // routing is visible to a toast() called from another module instance.
  firstUpdated(): void {
    const b = bus();
    b.add = (t) => this._add(t);
    b.remove = (id) => this._remove(id);
  }

  /**
   * Publish a toast directly to THIS viewport. Use when you have a
   * specific <ui-sonner> reference and want to bypass the global
   * `bus().add` routing (which always points to the last-mounted
   * viewport). Primary use case: docs demos that mount one viewport
   * per position and want each demo button to fire into its own
   * viewport. App code should normally call the global `toast()` /
   * `toast.success()` / etc., which route via the singleton.
   */
  addToast(message: string, opts: ToastOptions = {}, type: ToastType = 'default'): string | number {
    const id = opts.id ?? nextId++;
    this._add({
      id,
      type,
      message,
      description: opts.description,
      duration: opts.duration ?? (type === 'loading' ? 0 : 4000),
      action: opts.action,
      cancel: opts.cancel,
    });
    return id;
  }

  _add(item: ToastItem): void {
    this.items.set([...this.items.get(), item]);
    if (item.duration && item.duration > 0) {
      setTimeout(() => this._remove(item.id), item.duration);
    }
  }

  _remove(id: string | number): void {
    this.items.set(this.items.get().filter((i) => i.id !== id));
  }

  render() {
    const pos = POSITIONS[this.position] ?? POSITIONS['bottom-right'];
    // The container is a persistent live region: it is in the DOM from the
    // first render (even with zero toasts), so a screen reader announces
    // each toast as it is inserted. It is polite, and it is the ONLY live
    // root an ordinary toast resolves under.
    //
    // A non-error toast therefore carries no role of its own. It used to carry
    // role="status", which is itself a live region, so the toast resolved under
    // TWO nested live roots (measured over CDP, #1245) and some readers
    // double-announce that. The inner role bought nothing, because the viewport
    // is already polite. An `error` toast keeps role="alert", which is
    // load-bearing: it is the only way to make ONE item assertive inside a
    // polite viewport, and its second live root is the accepted cost.
    return html`<div
      data-slot="sonner"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
      class=${`pointer-events-none fixed z-[100] flex flex-col gap-2 ${pos}`}
    >
      ${repeat(
        this.items.get(),
        (item) => item.id,
        // The role is BRANCHED rather than written as a nullish hole. A hole
        // that evaluates to null serves role="" from the server renderer while
        // the client renderer removes the attribute, which is the divergence
        // test/ssr-aria.test.js exists to catch, and an empty role is worse
        // than no role: it is not a role, so the toast falls back to `generic`
        // in a way no attribute assertion would notice.
        (item) => (item.type === 'error'
          ? html`<div
              data-slot="sonner-toast"
              class=${TOAST_ITEM_BASE}
              data-type=${item.type}
              role="alert"
            >${this._toastBody(item)}</div>`
          : html`<div
              data-slot="sonner-toast"
              class=${TOAST_ITEM_BASE}
              data-type=${item.type}
            >${this._toastBody(item)}</div>`),
      )}
    </div>`;
  }

  // The toast's contents, shared by both arms of the role branch above.
  // A METHOD, not a module-scope value: a registry module does no work at
  // module scope.
  _toastBody(item: ToastItem) {
    return html`
          <div class=${`${TYPE_ICON_COLOR[item.type]} pt-0.5`}>${unsafeHTML(ICONS[item.type])}</div>
          <div class="flex-1">
            <div class="font-medium">${item.message}</div>
            ${item.description
              ? html`<div class="mt-1 text-xs text-muted-foreground">${item.description}</div>`
              : ''}
          </div>
          ${item.cancel
            ? html`<button
                type="button"
                data-slot="sonner-cancel"
                class="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                @click=${() => {
                  item.cancel!.onClick();
                  this._remove(item.id);
                }}
              >${item.cancel.label}</button>`
            : ''}
          ${item.action
            ? html`<button
                type="button"
                data-slot="sonner-action"
                class="rounded-md px-2 py-1 text-xs font-medium hover:bg-accent"
                @click=${() => {
                  item.action!.onClick();
                  this._remove(item.id);
                }}
              >${item.action.label}</button>`
            : ''}
          <button
            type="button"
            data-slot="sonner-close"
            aria-label="Close notification"
            class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            @click=${() => this._remove(item.id)}
          >${unsafeHTML(CLOSE_SVG)}</button>
        `;
  }
}
UiSonner.register('ui-sonner');

// The close affordance's own glyph. Decorative: the button's accessible name
// comes from its aria-label, so the icon must not be walked for a name.
const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// Type glyphs, all decorative: the toast's text carries the meaning, and the
// type is conveyed by role="alert" vs role="status", not by the picture.
const ICONS: Record<ToastType, string> = {
  default: '',
  success:
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  error:
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  info: '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning:
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  loading:
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>',
};
