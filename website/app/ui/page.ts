import { html } from '@webjsdev/core';
import { loadRegistryIndex } from '#modules/ui/queries/registry.server.ts';
import { splitByTier } from '#modules/ui/utils/tier.ts';

// Same "<Page> | <Section>" shape the documentation uses, so a tab or a search
// result reads consistently across /docs and /ui.
export const metadata = {
  title: 'WebJs UI | AI-first components for WebJs',
};

/**
 * The component library's introduction, served at /ui.
 *
 * There is no separate landing page. /ui opens straight into the gallery
 * shell with this page in the content column, the way /docs opens on Getting
 * Started, so a reader arrives at the components rather than at a pitch for
 * them.
 *
 * Counts come from the live registry index rather than prose, because the
 * hand-written ones drifted badly on the page this replaces: it advertised
 * "~55 components" against an actual 32, listed two dozen that had been
 * removed, and showed a <ui-button> / <ui-card> API the kit does not have.
 */
export default async function UiIntro() {
  const all = await loadRegistryIndex();
  const { tier1, tier2 } = splitByTier(all.filter((i) => i.type === 'registry:ui'));
  const total = tier1.length + tier2.length;

  return html`
    <div class="prose-docs">
      <h1>WebJs UI</h1>
      <p>
        An AI-first component library of ${total} primitives, built on native HTML and styled with
        Tailwind v4. The source is copied into your project, so you own every line and edit it
        freely. Variant names, sizes, and the <code>data-state</code> conventions mirror shadcn,
        so an agent trained on shadcn maps its knowledge across directly.
      </p>
      <p>
        It is built for WebJs apps and styled with Tailwind v4. Tier-1 helpers are plain functions
        returning class strings, and Tier-2 elements extend <code>WebComponent</code> from
        <code>@webjsdev/core</code>, so the kit assumes the runtime a WebJs app already has.
      </p>

      <h2>Two tiers, one mental model</h2>
      <p>
        <strong>Tier 1 (${tier1.length} components)</strong> is pure class-helper functions.
        <code>buttonClass()</code>, <code>cardClass()</code>, and <code>inputClass()</code> return
        Tailwind class strings that you apply to a real element, so a button is a real
        <code>&lt;button&gt;</code> and a checkbox is a real <code>&lt;input&gt;</code>. Form
        submission, autofill, browser validation, and screen readers all work natively, never
        proxied. A few wrap a platform primitive instead of a plain element: accordion and
        collapsible sit on <code>&lt;details&gt;</code>, progress on
        <code>&lt;progress value max&gt;</code>, popover on the <code>popover</code> attribute.
      </p>
      <code-block>import { cardClass, cardHeaderClass, cardTitleClass, cardContentClass } from '#modules/ui/components/card.ts';
import { buttonClass } from '#modules/ui/components/button.ts';

&lt;div class=\${cardClass()}&gt;
  &lt;div class=\${cardHeaderClass()}&gt;
    &lt;h3 class=\${cardTitleClass()}&gt;Hello&lt;/h3&gt;
  &lt;/div&gt;
  &lt;div class=\${cardContentClass()}&gt;
    &lt;button class=\${buttonClass({ variant: 'default' })}&gt;Click me&lt;/button&gt;
  &lt;/div&gt;
&lt;/div&gt;</code-block>

      <p>
        <strong>Tier 2 (${tier2.length} components)</strong> is a small set of stateful custom
        elements, for the behaviour the platform still does not ship: dialogs, tabs, menus,
        tooltips, hover cards, toggle groups, and toasts. Each one wraps the closest primitive it
        can (<code>&lt;ui-dialog&gt;</code> drives a native <code>&lt;dialog&gt;</code>, tooltip
        and hover-card use <code>popover="manual"</code>) and adds only the open-state tracking,
        focus trap, or queue on top.
      </p>
      <code-block>&lt;ui-dialog&gt;
  &lt;ui-dialog-trigger&gt;
    &lt;button class=\${buttonClass({ variant: 'outline' })}&gt;Edit profile&lt;/button&gt;
  &lt;/ui-dialog-trigger&gt;
  &lt;ui-dialog-content&gt;
    &lt;h2 data-slot="dialog-title" class=\${dialogTitleClass()}&gt;Edit profile&lt;/h2&gt;
    &lt;form action="/profile" method="post"&gt;…&lt;/form&gt;
  &lt;/ui-dialog-content&gt;
&lt;/ui-dialog&gt;</code-block>
      <p>
        Reach for Tier 1 by default. Reach for Tier 2 only when the browser does not ship the
        behaviour natively.
      </p>

      <h2>Install</h2>
      <p>
        In a WebJs app there is nothing to install. <code>@webjsdev/ui</code> is a hard dependency
        of <code>@webjsdev/cli</code>, so a global WebJs install already carries it. A scaffolded
        app does not pin the kit either: <code>webjs ui add</code> copies component source into
        <code>components/ui/</code>, and those files import <code>@webjsdev/core</code> rather
        than the kit.
      </p>
      <code-block>webjs ui init
webjs ui add button card dialog input label</code-block>
      <p>
        <code>init</code> writes <code>components.json</code>, copies the <code>cn()</code> helper
        into <code>lib/utils/cn.ts</code>, and installs the theme tokens.
        <code>add</code> resolves a component's transitive dependencies and copies the source into
        <code>components/ui/</code>, which is yours to edit from that point on.
      </p>

      <h2>Commands</h2>
      <table>
        <thead><tr><th scope="col">Command</th><th scope="col">What it does</th></tr></thead>
        <tbody>
          <tr><td><code>init</code></td><td>Writes <code>components.json</code>, copies <code>lib/utils/cn.ts</code>, installs the theme tokens. Re-running it preserves an existing project's settings and leaves edited helper files alone, so it is safe as a repair step (<code>--overwrite</code> resets them). Exits non-zero if the tokens cannot be written, because an unstyled install with a clean exit code is worse than a failure.</td></tr>
          <tr><td><code>add &lt;names...&gt;</code></td><td>Resolves transitive dependencies, copies the source in, installs npm dependencies, and self-heals missing theme tokens.</td></tr>
          <tr><td><code>list [filter]</code></td><td>Lists everything in the registry.</td></tr>
          <tr><td><code>view &lt;name&gt;</code></td><td>Prints a component's helpers, its paste-ready example, and its full source.</td></tr>
          <tr><td><code>diff [name]</code></td><td>Compares your local copy against the live registry.</td></tr>
          <tr><td><code>info</code></td><td>Project diagnostics: the resolved config and registry URL.</td></tr>
        </tbody>
      </table>
      <p>
        Resolution is local-first. <code>init</code>, <code>add</code>, <code>list</code>, and
        <code>view</code> read the registry that ships inside the installed
        <code>@webjsdev/ui</code> package, so an install is deterministic and works offline. Only
        <code>diff</code> and an explicit custom <code>--registry</code> go to the network. A Tier-1
        component's worked structural example is served on demand by
        <code>webjs ui view &lt;name&gt;</code> and by the read-only MCP <code>ui</code> tool, rather
        than copied into your file.
      </p>

      <h2>Accessibility</h2>
      <p>
        Responsibility splits by tier, and it matters which half you own.
        <strong>Tier-2 elements wire their own ARIA</strong>, so do not hand-add it: tabs
        cross-links its triggers and panels and reports orientation, toggle-group runs a roving
        tabindex with Arrow, Home, and End, dropdown-menu declares orientation and reflects
        <code>aria-disabled</code>, dialog and alert-dialog name themselves from their title and
        description on open, tooltip wires <code>aria-describedby</code>, hover-card exposes the
        popup relationship, and sonner is a live region.
      </p>
      <p>
        <strong>Tier-1 helpers return only classes</strong>, so the semantic element, the role, and
        the ARIA are yours. Every Tier-1 component's JSDoc carries an
        <code>A11y (required for accessible output)</code> block naming exactly what to supply: a
        name on an icon-only button, a role on an alert, <code>scope</code> on table headers,
        <code>alt</code> on an avatar image, a labelled <code>&lt;nav&gt;</code> with
        <code>aria-current="page"</code> on pagination and breadcrumb.
      </p>

      <h2>Dependencies</h2>
      <p>
        None beyond Tailwind v4 and <code>@webjsdev/core</code>. No Radix, no clsx, no
        tailwind-merge, no Floating UI, no Sonner. The <code>cn()</code> helper, the positioning,
        the focus trap, and the toast queue are all hand-rolled, so the whole kit is auditable in
        an afternoon and every line is yours to edit.
      </p>

      <h2>Migrating from shadcn</h2>
      <p>
        A Tier-2 element maps mechanically: <code>&lt;DialogContent&gt;</code> becomes
        <code>&lt;ui-dialog-content&gt;</code>, and variant and size props keep their names. A
        Tier-1 component has no wrapper at all, so <code>&lt;Button variant="outline"&gt;</code>
        becomes a real <code>&lt;button&gt;</code> carrying
        <code>buttonClass({ variant: 'outline' })</code>. There is no Radix
        <code>asChild</code> slot pattern to translate, because applying a class to the element you
        already have is what <code>asChild</code> was working around. An
        <code>onValueChange</code> prop becomes an
        <code>addEventListener('ui-value-change', fn)</code>.
      </p>
    </div>
  `;
}
