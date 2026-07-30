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
import { tierOf } from '#modules/ui/utils/tier.ts';
// Side-effect import: register <preview-tabs> so every preview pane below can
// flip between the live demo and its source snippet.
import '#components/preview-tabs.ts';

// ---------------------------------------------------------------------------
// Side-effect imports: the TIER-2 component modules, so their custom elements
// register and a preview containing a <ui-*> tag upgrades in the browser. The
// modules are mirrored from packages/ui/packages/registry into modules/ui/components/
// by scripts/copy-registry.mjs (run by webjs.dev.before / webjs.start.before
// and baked into the deploy image), so the source the server renders is the
// same source the browser is served.
//
// Only Tier 2 is imported here, and that is load-bearing rather than tidiness.
// A Tier-1 file exports class-helper functions and registers no element, so a
// bare side-effect import of one is a client-effecting NON-component import,
// which pins this whole page module into the browser bundle (AGENTS.md's
// execution model, and #963 on the path-aware verdict). The helpers are still
// imported BY NAME where they are used, in modules/ui/utils/examples.ts, which
// is what evaluates them during SSR. Importing all 32 here shipped the page,
// its snippet map, and its API metadata to every reader for nothing.
// ---------------------------------------------------------------------------
import '#modules/ui/components/alert-dialog.ts';
import '#modules/ui/components/dialog.ts';
import '#modules/ui/components/dropdown-menu.ts';
import '#modules/ui/components/hover-card.ts';
import '#modules/ui/components/sonner.ts';
import '#modules/ui/components/tabs.ts';
import '#modules/ui/components/toggle.ts';
import '#modules/ui/components/toggle-group.ts';
import '#modules/ui/components/tooltip.ts';

/**
 * Per-component metadata.
 *
 * Titles follow the documentation's shape, "<Page> | <Section>", so a browser
 * tab or a search result reads the same whether it came from /docs or here.
 * The registry name is the lowercase identifier you pass to the add command,
 * so it is title-cased for the human-facing title only.
 *
 * Each page describes ITSELF rather than inheriting one section description
 * from the layout for all 33 URLs. A set of byte-identical descriptions across
 * a section is exactly the duplicate-content shape this migration exists to
 * avoid, and it would have been self-defeating to introduce 33 of them in a
 * change whose stated purpose is search consolidation.
 *
 * The sentence is DERIVED rather than hand-written. The registry carries no
 * per-item description (checked: every `registry:ui` item omits it), so a
 * hand-written map would be 33 more strings to drift out of sync with the kit.
 * Tier plus the naming convention is enough to say something true and distinct
 * about every component, and it stays correct when one moves between tiers.
 */
export async function generateMetadata({ params }: { params: { name: string } }) {
  const name = startCase(params.name);
  const title = `${name} | WebJs UI`;
  let description: string;

  if (tierOf({ name: params.name }) === 'tier-2') {
    description = `${name} is a stateful custom element in WebJs UI. Compose it as a real ${'<ui-' + params.name + '>'} tag, which wires its own ARIA and keyboard handling, then copy the source into your project and own it.`;
  } else {
    const item = await loadRegistryItem(params.name);
    const helper = primaryHelper(params.name, item?.files?.[0]?.content ?? '');
    description = helper
      ? `${name} is a class helper in WebJs UI. Apply ${helper}() to a native HTML element for full browser semantics, styled with Tailwind v4, with the source copied into your project.`
      : `${name} is a class helper in WebJs UI. Apply it to a native HTML element for full browser semantics, styled with Tailwind v4, with the source copied into your project.`;
  }
  return { title, description, openGraph: { title, description } };
}

/**
 * The helper a reader reaches for first, read out of the component's own
 * source rather than guessed from its name.
 *
 * The convention (`alert-dialog` to `alertDialogClass`) holds for most of the
 * kit but not all of it, and a description naming a function that does not
 * exist is worse than a vaguer one. `breadcrumb` exports `breadcrumbListClass`,
 * `popover` exports `popoverContentClass`, and `switch` exports
 * `switchInputClass` and `switchTrackClass`, with no bare `xClass` in any of
 * the three. Preferring the exact conventional name and falling back to the
 * first exported helper keeps every description true, and true automatically
 * when the kit adds or renames one.
 */
function primaryHelper(name: string, source: string): string | null {
  const exported = [...source.matchAll(/export\s+(?:function|const)\s+([a-zA-Z0-9_$]*Class)\b/g)].map((m) => m[1]);
  if (!exported.length) return null;
  const conventional = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Class';
  return exported.includes(conventional) ? conventional : exported[0];
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
 * (declared in lib/ui/docs-shell.ts) and the scope the client highlighter reads,
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
        ${npmDeps.map((d: string) => html`<code class="rounded-md px-2 py-1 text-xs bg-bg-subtle text-fg-muted">${d}</code>`)}
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
                            <th scope="col" class=${TH}>Name</th>
                            <th scope="col" class=${TH}>Description</th>
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
                            <th scope="col" class=${TH}>Prop</th>
                            <th scope="col" class=${TH}>Type</th>
                            <th scope="col" class=${TH}>Default</th>
                            ${api.props.some((p) => p.description)
                              ? html`<th scope="col" class=${TH}>Description</th>`
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
                            <th scope="col" class=${TH}>Name</th>
                            <th scope="col" class=${TH}>Detail</th>
                            <th scope="col" class=${TH}>Description</th>
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
      <!-- The height cap and the scroll live on the PRE, not on a wrapper
           around it. The pre is what carries the border, background, and
           rounded corners (from .prose-docs in lib/ui/docs-shell.ts), and a
           scrollbar renders inside its own element's border box. Put the
           overflow on an outer div and the scrollbar sits outside the visible
           rectangle, detached from the card it is scrolling. -->
      <div class="prose-docs ui-code"><pre class="text-xs max-h-120 overflow-y-auto"><code>${source}</code></pre></div>
    </section>
  `;
}
