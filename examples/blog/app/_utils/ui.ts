/**
 * Shared UI helpers for pages and layouts.
 *
 * Each helper returns a fragment of Tailwind-class markup that would
 * otherwise be duplicated across multiple pages. Because these run at
 * SSR time inside an `html\`\`` template, the output HTML is identical
 * to writing the classes inline — the browser sees fully-materialised
 * elements, no client-side runtime.
 *
 * Naming: small typographic primitives (`rubric`, `stat`) and repeated
 * molecules (`backLink`, `banner`, `codeChip`). Keep this file terse —
 * prefer inlining one-off classes in the page itself.
 */
import { html } from '@webjskit/core';

/** `● label` kicker — small caps, accent colour, above headings. */
export function rubric(label: string, mb: 'sm' | 'md' = 'md') {
  const mbCls = mb === 'sm' ? 'mb-3' : 'mb-4';
  return html`
    <span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-accent ${mbCls}">● ${label}</span>
  `;
}

/** Tiny monospaced small-caps label. Used for stats, counts, bylines. */
export function stat(content: unknown, extraCls = '') {
  return html`
    <span class="font-mono text-[11px] leading-none font-medium tracking-[0.15em] uppercase text-fg-subtle ${extraCls}">${content}</span>
  `;
}

/** "← label" back link — typography matches `stat`. */
export function backLink(href: string, label: string, mb: 'sm' | 'md' = 'md') {
  const mbCls = mb === 'sm' ? 'mb-6' : 'mb-12';
  return html`
    <a href=${href} class="inline-block ${mbCls} text-fg-subtle no-underline font-mono text-[11px] leading-none font-medium tracking-[0.15em] uppercase transition-colors duration-fast hover:text-fg">← ${label}</a>
  `;
}

/** Large display heading — used on home, about, blog post detail. */
export function displayH1(content: unknown) {
  return html`
    <h1 class="font-serif text-display leading-[1.02] tracking-[-0.035em] font-bold m-0 mb-6 text-balance">${content}</h1>
  `;
}

/** Clamp-scale H1 — slightly smaller than `displayH1`; login, new post. */
export function clampH1(content: unknown) {
  return html`
    <h1 class="font-serif text-[clamp(2rem,1.5rem+1.6vw,2.8rem)] leading-[1.08] tracking-[-0.03em] font-bold m-0 mb-6">${content}</h1>
  `;
}

/** Section H2 — serif, smaller than H1, used to divide page sections. */
export function sectionH2(content: unknown, mb: 'sm' | 'md' = 'sm') {
  const mbCls = mb === 'sm' ? 'mb-2' : 'mb-4';
  return html`
    <h2 class="font-serif text-[1.6rem] tracking-[-0.02em] font-bold m-0 ${mbCls}">${content}</h2>
  `;
}

/** Notice/banner paragraph — soft card above the primary content. */
export function banner(content: unknown) {
  return html`
    <p class="p-6 bg-[color-mix(in_oklch,var(--bg-elev)_50%,transparent)] border border-border rounded-[10px] text-sm my-6 mb-12 text-fg-muted">${content}</p>
  `;
}

/** Inline accent link — used inside banners and body copy. */
export function accentLink(href: string, label: unknown) {
  return html`
    <a href=${href} class="text-accent font-semibold no-underline hover:underline hover:underline-offset-[3px]">${label}</a>
  `;
}

/** Small code chip — inline monospaced token with a tinted surface. */
export function codeChip(text: string) {
  return html`
    <code class="font-mono text-[0.88em] px-1.5 py-0.5 rounded-md bg-bg-subtle border border-border break-words [overflow-wrap:anywhere]">${text}</code>
  `;
}
