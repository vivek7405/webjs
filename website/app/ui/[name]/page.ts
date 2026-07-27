import { html, unsafeHTML, notFound } from '@webjsdev/core';
import {
  getExample,
  getVariantExamples,
  getSizeExamples,
  getIconSizeExamples,
  renderExample,
  codeExample,
} from '#modules/ui/utils/examples.ts';
import { getComponentApi, type ComponentApi } from '#modules/ui/utils/component-api.ts';
import { loadRegistryItem } from '#modules/ui/queries/registry.server.ts';
// Side-effect import: register <preview-tabs> so every preview pane below can
// flip between the live demo and its source snippet.
import '#components/preview-tabs.ts';

// ---------------------------------------------------------------------------
// Side-effect imports: load every ui-* component module so the custom
// elements register and the preview pane can render any of them. The modules
// are mirrored from packages/ui/packages/registry into components/ui/ by
// scripts/copy-registry.mjs (run by webjs.dev.before / webjs.start.before and
// baked into the deploy image), so the source the server renders is the same
// source the browser is served.
// ---------------------------------------------------------------------------
import '#components/ui/accordion.ts';
import '#components/ui/alert.ts';
import '#components/ui/alert-dialog.ts';
import '#components/ui/aspect-ratio.ts';
import '#components/ui/avatar.ts';
import '#components/ui/badge.ts';
import '#components/ui/breadcrumb.ts';
import '#components/ui/button.ts';
import '#components/ui/card.ts';
import '#components/ui/checkbox.ts';
import '#components/ui/collapsible.ts';
import '#components/ui/dialog.ts';
import '#components/ui/dropdown-menu.ts';
import '#components/ui/hover-card.ts';
import '#components/ui/input.ts';
import '#components/ui/kbd.ts';
import '#components/ui/label.ts';
import '#components/ui/native-select.ts';
import '#components/ui/pagination.ts';
import '#components/ui/popover.ts';
import '#components/ui/progress.ts';
import '#components/ui/radio-group.ts';
import '#components/ui/separator.ts';
import '#components/ui/skeleton.ts';
import '#components/ui/sonner.ts';
import '#components/ui/switch.ts';
import '#components/ui/table.ts';
import '#components/ui/tabs.ts';
import '#components/ui/textarea.ts';
import '#components/ui/toggle.ts';
import '#components/ui/toggle-group.ts';
import '#components/ui/tooltip.ts';

/**
 * Titles follow the documentation's shape, "<Page> | <Section>", so a browser
 * tab or a search result reads the same whether it came from /docs or here.
 * The registry name is the lowercase identifier you pass to `webjs ui add`, so
 * it is title-cased for the human-facing title only.
 */
export function generateMetadata({ params }: { params: { name: string } }) {
  return { title: `${startCase(params.name)} | WebJs UI` };
}

/**
 * One preview pane around an example snippet.
 *
 * `.ui-preview` is what makes the demo render in the KIT's neutral palette
 * rather than this site's warm editorial one (the raw shadcn variables are
 * declared on that class in public/input.css). A preview has to look like the
 * reader's own app, not like the page around it.
 *
 * Light DOM plus `unsafeHTML` is required because ui-* custom elements capture
 * their innerHTML in connectedCallback, which does not run during SSR;
 * deferring to the browser lets the upgrade fire correctly.
 *
 * flex-wrap so multi-value combined panes (all 8 button sizes, all 6 button
 * variants) lay out in a row and wrap when narrow.
 */
function previewPane(snippet: string, opts: { minH?: string } = {}) {
  const minH = opts.minH ?? '160px';
  return html`
    <div
      class="ui-preview rounded-lg border border-border p-8 flex flex-wrap items-center justify-center gap-4 bg-background text-foreground"
      style="min-height: ${minH}"
    >
      ${unsafeHTML(snippet)}
    </div>
  `;
}

// Strip the shared leading indentation off a snippet so the Code view reads
// like hand-written markup rather than template-literal-indented source.
function dedent(snippet: string): string {
  const lines = snippet.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
  const widths = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => (l.match(/^[ \t]*/)?.[0].length ?? 0));
  const trim = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(trim)).join('\n');
}

/**
 * The "Code" side of a preview: the idiomatic snippet that composes the demo,
 * escaped (text interpolation, not unsafeHTML) so the markup shows as source.
 *
 * Wrapped in `.prose-docs` on purpose. That is the site's one code surface
 * (declared in lib/docs-shell.ts) and the scope the client highlighter reads,
 * so a snippet here gets the same card and the same token colors as one in the
 * documentation, for free. `.ui-code` drops the trailing block margin the
 * prose rules add, since a tab pane is not a paragraph flow.
 */
function codePane(code: string) {
  return html`<div class="prose-docs ui-code"><pre><code>${dedent(code)}</code></pre></div>`;
}

// Wraps a live preview and its source in <preview-tabs> so the reader can flip
// between them. Both sides derive from ONE authored snippet: renderExample()
// evaluates the frozen class-helper holes for the live demo, codeExample()
// keeps them as calls so the Code tab teaches the idiomatic helper usage.
function previewWithCode(snippet: string, opts: { minH?: string } = {}) {
  return html`
    <preview-tabs>
      <div slot="preview">${previewPane(renderExample(snippet), opts)}</div>
      <div slot="code">${codePane(codeExample(snippet))}</div>
    </preview-tabs>
  `;
}

// Concatenate all defined values from a variant/size example map into one
// snippet for the combined preview pane. Skips keys missing from the
// examples map so a stale metadata entry doesn't blank the pane.
function combineExamples(keys: string[], examples: Record<string, string>): string {
  return keys
    .map((k) => examples[k])
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('\n');
}

function startCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const SECTION_HEADING = 'text-base font-medium mb-3 text-fg-muted';

// Render a value-keyed preview section in one of two modes.
// 'combined': one preview pane with every value rendered side by side.
// 'cards':   one preview pane per value, each with a heading above.
// The cards mode is for cases where the example markup is identical
// across values and only the visual style differs (e.g. tabs default vs
// underline both render the same Account/Password tabs).
function renderValueSection(
  heading: string,
  keys: string[],
  examples: Record<string, string>,
  mode: 'combined' | 'cards' = 'combined',
) {
  if (mode === 'cards') {
    return html`
      <section class="mb-12">
        <h2 class=${SECTION_HEADING}>${heading}</h2>
        <div class="grid gap-4">
          ${keys.map((k) =>
            examples[k]
              ? html`
                  <div>
                    <h3 class="text-sm font-medium mb-2 text-fg">${startCase(k)}</h3>
                    ${previewWithCode(examples[k])}
                  </div>
                `
              : '',
          )}
        </div>
      </section>
    `;
  }
  return html`
    <section class="mb-12">
      <h2 class=${SECTION_HEADING}>${heading}</h2>
      ${previewWithCode(combineExamples(keys, examples))}
    </section>
  `;
}

const TABLE_WRAP = 'rounded-lg border border-border overflow-hidden';
const TH = 'px-3 py-2 font-medium text-fg-muted';
const TD = 'px-3 py-2 align-top';
const TD_MUTED = 'px-3 py-2 align-top text-fg-muted';
const ROW = 'border-t border-border';

/**
 * One component's page.
 *
 * The heading is title-cased for reading, while the registry identifier stays
 * lowercase everywhere it is a value you type (the Installation command, the
 * source path, the sidebar links). There is no back link to the index: the
 * sidebar lists every component on every page, so a dedicated "up" control
 * would be a second way to do what the nav already does.
 */
export default async function ComponentDoc({ params }: { params: { name: string } }) {
  const item = await loadRegistryItem(params.name);
  // Only components are addressable here. The registry also holds themes and
  // lib items, which have no page to render and would otherwise 200 on an
  // empty shell.
  if (!item || item.type !== 'registry:ui') throw notFound();

  const source = item.files?.[0]?.content || '';
  const npmDeps = (item.dependencies || []).filter((d: string) => d !== '@webjsdev/core');
  const registryDeps = item.registryDependencies || [];
  const example = getExample(params.name);
  const api: ComponentApi | null = getComponentApi(params.name);
  const variantExamples = getVariantExamples(params.name);
  const sizeExamples = getSizeExamples(params.name);
  const iconSizeExamples = getIconSizeExamples(params.name);

  return html`
    <style>
      /* A code pane inside a preview toggle is not a paragraph flow, so it
         drops the block margin the shared prose rules add. Two classes deep so
         it beats .prose-docs pre on specificity rather than on source order,
         which would otherwise depend on the layout's style block being
         hoisted first. */
      .prose-docs.ui-code > pre { margin: 0; }
    </style>

    <header class="mb-8">
      <h1 class="font-serif font-bold text-[length:var(--text-doc-h1)] leading-[1.12] tracking-[-0.025em] text-fg">${startCase(item.name)}</h1>
      ${item.description ? html`<p class="mt-2 text-base text-fg-muted">${item.description}</p>` : ''}
      <div class="mt-4 flex flex-wrap gap-2 text-xs">
        <span class="rounded-md border border-border px-2 py-1 text-fg-muted">${item.type.replace('registry:', '')}</span>
        ${registryDeps.map((d: string) => html`<a href="/ui/${d}" class="rounded-md border border-border px-2 py-1 no-underline text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors">↳ ${d}</a>`)}
        ${npmDeps.map((d: string) => html`<code class="rounded-md px-2 py-1 text-[11px] bg-bg-subtle text-fg-muted">${d}</code>`)}
      </div>
    </header>

    ${
      example
        ? html`
          <section class="mb-12">
            <h2 class=${SECTION_HEADING}>Preview</h2>
            ${previewWithCode(example, { minH: '280px' })}
          </section>
        `
        : html`
          <section class="mb-12">
            <div class="rounded-lg border border-border p-8 text-sm text-fg-muted bg-bg-subtle">
              No live preview available for this component yet. The source code below shows
              the full implementation; <code>webjs ui add ${item.name}</code> copies it into your project.
            </div>
          </section>
        `
    }

    <section class="mb-12">
      <h2 class=${SECTION_HEADING}>Installation</h2>
      <div class="prose-docs ui-code"><pre><code>webjs ui add ${item.name}</code></pre></div>
    </section>

    ${
      api?.variants && variantExamples && !api.hideVariantsSection
        ? renderValueSection(
            api.variantsLabel ?? 'Variants',
            api.variants,
            variantExamples,
            api.variantsPreviewMode ?? 'combined',
          )
        : ''
    }

    ${
      api?.sizes && sizeExamples && !api.hideSizesSection
        ? renderValueSection(
            api.sizesLabel ?? 'Sizes',
            api.sizes,
            sizeExamples,
            api.sizesPreviewMode ?? 'combined',
          )
        : ''
    }

    ${
      api?.iconSizes && iconSizeExamples
        ? renderValueSection(api.iconSizesLabel ?? 'Icon', api.iconSizes, iconSizeExamples, 'combined')
        : ''
    }

    ${
      api && (api.props?.length || api.subcomponents?.length || api.events?.length)
        ? html`
          <section class="mb-12">
            <h2 class=${SECTION_HEADING}>API Reference</h2>

            ${
              api.subcomponents?.length
                ? html`
                  <div class="mb-6">
                    <h3 class="text-sm font-medium mb-2 text-fg">Parts</h3>
                    <div class=${TABLE_WRAP}>
                      <table class="w-full text-sm">
                        <thead class="bg-bg-subtle">
                          <tr class="text-left">
                            <th class=${TH}>Name</th>
                            <th class=${TH}>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${api.subcomponents.map(
                            (p) => html`
                              <tr class=${ROW}>
                                <td class=${TD}><code class="text-xs">${p.name}</code></td>
                                <td class=${TD_MUTED}>${p.description}</td>
                              </tr>
                            `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `
                : ''
            }

            ${
              api.props?.length
                ? html`
                  <div class="mb-6">
                    <h3 class="text-sm font-medium mb-2 text-fg">Props</h3>
                    <div class=${TABLE_WRAP}>
                      <table class="w-full text-sm">
                        <thead class="bg-bg-subtle">
                          <tr class="text-left">
                            <th class=${TH}>Prop</th>
                            <th class=${TH}>Type</th>
                            <th class=${TH}>Default</th>
                            ${api.props.some((p) => p.description)
                              ? html`<th class=${TH}>Description</th>`
                              : ''}
                          </tr>
                        </thead>
                        <tbody>
                          ${api.props.map(
                            (p) => html`
                              <tr class=${ROW}>
                                <td class=${TD}><code class="text-xs">${p.name}</code></td>
                                <td class=${TD}><code class="text-xs">${p.type}</code></td>
                                <td class=${TD_MUTED}>${p.default ?? ''}</td>
                                ${api.props!.some((q) => q.description)
                                  ? html`<td class=${TD_MUTED}>${p.description ?? ''}</td>`
                                  : ''}
                              </tr>
                            `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `
                : ''
            }

            ${
              api.events?.length
                ? html`
                  <div>
                    <h3 class="text-sm font-medium mb-2 text-fg">Events</h3>
                    <div class=${TABLE_WRAP}>
                      <table class="w-full text-sm">
                        <thead class="bg-bg-subtle">
                          <tr class="text-left">
                            <th class=${TH}>Name</th>
                            <th class=${TH}>Detail</th>
                            <th class=${TH}>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${api.events.map(
                            (e) => html`
                              <tr class=${ROW}>
                                <td class=${TD}><code class="text-xs">${e.name}</code></td>
                                <td class=${TD}><code class="text-xs">${e.detail ?? ''}</code></td>
                                <td class=${TD_MUTED}>${e.description ?? ''}</td>
                              </tr>
                            `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `
                : ''
            }
          </section>
        `
        : ''
    }

    <section>
      <h2 class=${SECTION_HEADING}>Source: <code class="text-xs px-1.5 py-0.5 rounded bg-bg-subtle">components/ui/${item.name}.ts</code></h2>
      <div class="prose-docs ui-code max-h-[480px] overflow-y-auto rounded-xl"><pre class="text-xs"><code>${source}</code></pre></div>
    </section>
  `;
}
