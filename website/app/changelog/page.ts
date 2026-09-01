import { html, unsafeHTML } from '@webjsdev/core';
import { listEntries } from '#modules/changelog/queries/list-entries.server.ts';
import { renderEntryBody } from '#modules/changelog/utils/render-entry.ts';
import { pkgBadge } from '#modules/changelog/utils/pkg-badge.ts';

/**
 * /changelog
 *
 * Thin route adapter. File-reading, frontmatter parsing, body
 * rendering, and the package badge all live in
 * `modules/changelog/`. This page composes them.
 */

export const metadata = {
  title: 'Changelog · WebJs',
  description: 'Per-package, per-version release notes for the WebJs framework (@webjsdev/core, server, cli, intellisense, ui, mcp) plus the WebJs editor extensions for VS Code and Neovim.',
};

export default async function Changelog() {
  const entries = await listEntries();
  return html`
    <main id="main" tabindex="-1" class="max-w-210 mx-auto px-6 py-12 focus:outline-none">
      <header class="mb-10">
        <h1 class="font-serif text-hub leading-[1.05] tracking-tight text-fg mb-3">What shipped</h1>
        <p class="text-fg-muted text-sm leading-relaxed max-w-2xl">
          Per-package, per-version release notes for <code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">@webjsdev/core</code>,
          <code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">/server</code>,
          <code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">/cli</code>,
          <code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">/intellisense</code>,
          <code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">/ui</code>, and
          <code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">/mcp</code>,
          plus the WebJs editor extensions for VS Code
          (<code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">vscode</code>) and Neovim
          (<code class="font-mono text-sm bg-fg/8 px-1 py-0.5 rounded">nvim</code>).
          Each version-bump produces one entry, automatically.
        </p>
      </header>

      ${entries.length === 0
        ? html`<p class="text-fg-subtle italic">No entries yet.</p>`
        : entries.map((e) => html`
            <article class="border border-border rounded-xl bg-bg-elev p-5 sm:p-6 mb-5 shadow-sm">
              <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                ${pkgBadge(e.shortPkg)}
                <h2 class="font-mono text-lg font-semibold text-fg tracking-tight m-0">v${e.version}</h2>
                <time class="font-mono text-xs text-fg-subtle tracking-tight">${e.date.slice(0, 10)}</time>
                <span class="text-xs text-fg-subtle">${e.commitCount} change${e.commitCount === 1 ? '' : 's'}</span>
              </header>
              <div class="[overflow-wrap:anywhere]">${unsafeHTML(renderEntryBody(e.body))}</div>
            </article>
          `)}
    </main>
  `;
}
