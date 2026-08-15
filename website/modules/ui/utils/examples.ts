/**
 * Curated example markup per component, rendered as the "Preview" pane on
 * the component docs page.
 *
 * The map is intentionally hand-curated rather than auto-generated so each
 * component shows a representative use case.
 *
 * Architecture note: examples for **Tier-1 class-helper components** (button,
 * card, badge, alert, popover, accordion, collapsible, etc.) use native HTML
 * elements (including <dialog>, <details>/<summary>, and the popover
 * attribute) with the helper output inlined as `class="..."`. Examples for
 * **Tier-2 stateful custom elements** (dialog, alert-dialog, tabs, tooltip,
 * hover-card, dropdown-menu, sonner) use the `<ui-*>` tags directly.
 *
 * The helper-class strings below are kept in sync with the registry helpers
 * by importing them at module load and producing each example string fresh.
 */
import {
  buttonClass,
} from '#modules/ui/components/button.ts';
import {
  badgeClass,
} from '#modules/ui/components/badge.ts';
import {
  alertClass,
  alertTitleClass,
  alertDescriptionClass,
} from '#modules/ui/components/alert.ts';
import {
  cardClass,
  cardHeaderClass,
  cardTitleClass,
  cardDescriptionClass,
  cardContentClass,
  cardFooterClass,
} from '#modules/ui/components/card.ts';
import { inputClass } from '#modules/ui/components/input.ts';
import { labelClass } from '#modules/ui/components/label.ts';
import { textareaClass } from '#modules/ui/components/textarea.ts';
import { checkboxClass } from '#modules/ui/components/checkbox.ts';
import { radioClass, radioGroupClass } from '#modules/ui/components/radio-group.ts';
import { switchInputClass, switchTrackClass } from '#modules/ui/components/switch.ts';
import {
  nativeSelectWrapperClass,
  nativeSelectClass,
  nativeSelectIconClass,
} from '#modules/ui/components/native-select.ts';
import {
  avatarClass,
  avatarImageClass,
  avatarFallbackClass,
  avatarGroupClass,
} from '#modules/ui/components/avatar.ts';
import { separatorClass } from '#modules/ui/components/separator.ts';
import { skeletonClass } from '#modules/ui/components/skeleton.ts';
import { aspectRatioClass } from '#modules/ui/components/aspect-ratio.ts';
import { kbdClass, kbdGroupClass } from '#modules/ui/components/kbd.ts';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableBodyClass,
  tableRowClass,
  tableHeadClass,
  tableCellClass,
  tableCaptionClass,
} from '#modules/ui/components/table.ts';
import { toggleClass } from '#modules/ui/components/toggle.ts';
import { progressClass } from '#modules/ui/components/progress.ts';
import { tabsListClass } from '#modules/ui/components/tabs.ts';
import {
  breadcrumbListClass,
  breadcrumbItemClass,
  breadcrumbLinkClass,
  breadcrumbPageClass,
  breadcrumbSeparatorClass,
} from '#modules/ui/components/breadcrumb.ts';
import {
  paginationClass,
  paginationContentClass,
  paginationLinkClass,
  paginationPreviousClass,
  paginationNextClass,
} from '#modules/ui/components/pagination.ts';
import {
  fieldClass,
  hintClass,
  stackClass,
} from '#lib/utils/cn.ts';
import {
  dialogHeaderClass,
  dialogTitleClass,
  dialogDescriptionClass,
  dialogFooterClass,
} from '#modules/ui/components/dialog.ts';
import {
  popoverContentClass,
  popoverHeaderClass,
  popoverTitleClass,
  popoverDescriptionClass,
} from '#modules/ui/components/popover.ts';
import {
  accordionClass,
  accordionItemClass,
  accordionTriggerClass,
  accordionContentClass,
} from '#modules/ui/components/accordion.ts';
import {
  collapsibleClass,
  collapsibleTriggerClass,
  collapsibleContentClass,
} from '#modules/ui/components/collapsible.ts';
import {
  alertDialogContentClass,
  alertDialogHeaderClass,
  alertDialogTitleClass,
  alertDialogDescriptionClass,
  alertDialogFooterClass,
} from '#modules/ui/components/alert-dialog.ts';

// --------------------------------------------------------------------------
// Single source of truth for previews (#866 follow-up)
//
// Every example below is authored the way an end user composes the component:
// the class-helper call sits INLINE in the markup as a frozen `${xClass(...)}`
// hole (the leading `${` is backslash-escaped, so the string stores the call
// verbatim instead of interpolating it at module load). Two derivations read
// off that single source.
//   - renderExample() evaluates each frozen hole to its class string, for the
//     live preview (unsafeHTML needs real classes to render).
//   - codeExample() shows each hole as the call, for the Code tab, so the
//     snippet teaches the helper usage rather than the expanded class soup.
// Only class-helper holes are frozen; structural holes (${type}, ${position})
// and ${ICON_SETTINGS} stay live and are resolved at authoring time.
// --------------------------------------------------------------------------

// Registry the frozen holes are evaluated against. Listing every imported
// helper here also keeps each import "used" after the freeze.
//
// The helpers take heterogeneous arguments (none, a size, a variant object),
// and every call goes through the `new Function` evaluator below rather than a
// typed call site, so the only contract this map can honestly state is
// "callable, returns a class string". `never[]` says exactly that: each
// concrete helper is assignable to it, and it refuses a direct call with
// invented arguments, which `any[]` would have waved through.
import {
  emptyStateClass, emptyStateMediaClass, emptyStateTitleClass,
  emptyStateDescriptionClass, emptyStateActionsClass,
} from '#modules/ui/components/empty-state.ts';
import {
  statGroupClass, statClass, statLabelClass, statValueClass, statDeltaClass,
} from '#modules/ui/components/stat.ts';
import {
  pageHeaderClass, pageHeaderTitleClass, pageHeaderDescriptionClass, pageHeaderActionsClass,
} from '#modules/ui/components/page-header.ts';
import {
  fieldSetClass, fieldLegendClass, fieldGroupClass, inputGroupClass,
  inputGroupAddonClass, inputGroupTextClass, fieldErrorClass,
} from '#modules/ui/components/field-group.ts';
import {
  descriptionListClass, descriptionRowClass, descriptionTermClass, descriptionDetailsClass,
} from '#modules/ui/components/description-list.ts';
import {
  timelineClass, timelineItemClass, timelineMarkerClass, timelineConnectorClass,
  timelineContentClass, timelineTitleClass, timelineTimeClass,
} from '#modules/ui/components/timeline.ts';

const HELPERS: Record<string, (...args: never[]) => string> = {
  accordionClass, accordionContentClass, accordionItemClass, accordionTriggerClass,
  alertClass, alertDescriptionClass, alertTitleClass,
  alertDialogContentClass, alertDialogDescriptionClass, alertDialogFooterClass,
  alertDialogHeaderClass, alertDialogTitleClass,
  avatarClass, avatarFallbackClass, avatarGroupClass, avatarImageClass,
  badgeClass,
  breadcrumbItemClass, breadcrumbLinkClass, breadcrumbListClass, breadcrumbPageClass, breadcrumbSeparatorClass,
  buttonClass,
  cardClass, cardContentClass, cardDescriptionClass, cardFooterClass, cardHeaderClass, cardTitleClass,
  checkboxClass,
  collapsibleClass, collapsibleContentClass, collapsibleTriggerClass,
  dialogDescriptionClass, dialogFooterClass, dialogHeaderClass, dialogTitleClass,
  fieldClass, hintClass, inputClass, kbdClass, kbdGroupClass, labelClass,
  nativeSelectClass, nativeSelectIconClass, nativeSelectWrapperClass,
  paginationClass, paginationContentClass, paginationLinkClass, paginationNextClass, paginationPreviousClass,
  popoverContentClass, popoverDescriptionClass, popoverHeaderClass, popoverTitleClass,
  aspectRatioClass,
  progressClass, radioClass, radioGroupClass, separatorClass, skeletonClass, stackClass,
  switchInputClass, switchTrackClass,
  tableBodyClass, tableCellClass, tableClass, tableContainerClass, tableHeadClass, tableHeaderClass, tableRowClass,
  tableCaptionClass,
  tabsListClass, textareaClass, toggleClass,
  // #1116. A helper missing from this map is not an error: evalHole fails soft
  // to an empty class, so the preview renders unstyled and still returns 200.
  emptyStateClass, emptyStateMediaClass, emptyStateTitleClass,
  emptyStateDescriptionClass, emptyStateActionsClass,
  statGroupClass, statClass, statLabelClass, statValueClass, statDeltaClass,
  pageHeaderClass, pageHeaderTitleClass, pageHeaderDescriptionClass, pageHeaderActionsClass,
  fieldSetClass, fieldLegendClass, fieldGroupClass, inputGroupClass,
  inputGroupAddonClass, inputGroupTextClass, fieldErrorClass,
  descriptionListClass, descriptionRowClass, descriptionTermClass, descriptionDetailsClass,
  timelineClass, timelineItemClass, timelineMarkerClass, timelineConnectorClass,
  timelineContentClass, timelineTitleClass, timelineTimeClass,
};

// Evaluate one authored call expression such as buttonClass({ variant: 'x' })
// against HELPERS. Runs server-side only (from the page render), over strings
// this module authored, never user input. Fails soft to an empty class.
function evalHole(expr: string): string {
  try {
    return String(new Function('H', `return (H.${expr});`)(HELPERS));
  } catch {
    return '';
  }
}

// Walk a frozen snippet, replacing each hole. Uses a brace-balanced scan so
// object-literal args do not end the hole early. In render mode a hole becomes
// its evaluated class string (quotes left as authored); in code mode a hole
// becomes the call verbatim, and when the hole is the ENTIRE quoted attribute
// value the quotes are dropped so it reads as the idiomatic unquoted form.
function buildExample(src: string, mode: 'render' | 'code'): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('${', i);
    if (open === -1) {
      out += src.slice(i);
      break;
    }
    let depth = 0;
    let j = open + 2;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0) break;
        depth--;
      }
    }
    const before = src.slice(i, open);
    const expr = src.slice(open + 2, j).trim();
    if (mode === 'render') {
      out += before + evalHole(expr);
      i = j + 1;
    } else if (before.endsWith('="') && src[j + 1] === '"') {
      out += before.slice(0, -1) + '${' + expr + '}';
      i = j + 2;
    } else {
      out += before + '${' + expr + '}';
      i = j + 1;
    }
  }
  return out;
}

/** A snippet with every class-helper hole evaluated, for the live preview. */
export function renderExample(src: string): string {
  return buildExample(src, 'render');
}

/** A snippet with every class-helper hole shown as the call, for the Code tab. */
export function codeExample(src: string): string {
  return buildExample(src, 'code');
}

// --------------------------------------------------------------------------
// Tier-1 examples (class-helper functions on native HTML)
// --------------------------------------------------------------------------

const EXAMPLES: Record<string, string> = {
  // #1116. Live previews for the six primitives added with the design work.
  // Without an entry here the gallery page serves its "no live preview"
  // fallback, so a component can ship, be listed, and still show nothing.
  'empty-state': `
    <div class="\${emptyStateClass({ variant: 'bordered' })}">
      <h3 class="\${emptyStateTitleClass()}">No invoices yet</h3>
      <p class="\${emptyStateDescriptionClass()}">Invoices you send appear here, with their payment status.</p>
      <div class="\${emptyStateActionsClass()}">
        <button class="\${buttonClass()}">Create invoice</button>
        <button class="\${buttonClass({ variant: 'ghost' })}">Learn more</button>
      </div>
    </div>
  `,

  stat: `
    <div class="\${statGroupClass({ columns: 3 })}">
      <dl class="\${statClass({ variant: 'card' })}">
        <dt class="\${statLabelClass()}">Delivered</dt>
        <dd class="\${statValueClass()}">1,284</dd>
        <dd class="\${statDeltaClass({ direction: 'up' })}">up 12% from yesterday</dd>
      </dl>
      <dl class="\${statClass({ variant: 'card' })}">
        <dt class="\${statLabelClass()}">In transit</dt>
        <dd class="\${statValueClass()}">37</dd>
        <dd class="\${statDeltaClass({ direction: 'flat' })}">unchanged</dd>
      </dl>
      <dl class="\${statClass({ variant: 'card' })}">
        <dt class="\${statLabelClass()}">Failed</dt>
        <dd class="\${statValueClass()}">3</dd>
        <dd class="\${statDeltaClass({ direction: 'down' })}">down 2 from yesterday</dd>
      </dl>
    </div>
  `,

  'page-header': `
    <header class="\${pageHeaderClass({ variant: 'bordered' })}">
      <div>
        <h1 class="\${pageHeaderTitleClass()}">Invoices</h1>
        <p class="\${pageHeaderDescriptionClass()}">Everything you have sent, and whether it has been paid.</p>
      </div>
      <div class="\${pageHeaderActionsClass()}">
        <button class="\${buttonClass({ variant: 'outline' })}">Export</button>
        <button class="\${buttonClass()}">New invoice</button>
      </div>
    </header>
  `,

  'field-group': `
    <fieldset class="\${fieldSetClass()}">
      <legend class="\${fieldLegendClass()}">Billing</legend>
      <div class="\${fieldGroupClass()}">
        <div class="grid gap-1">
          <label class="text-sm font-medium" for="ui-price">Price</label>
          <div class="\${inputGroupClass()}">
            <span class="\${inputGroupAddonClass({ side: 'start' })}" aria-hidden="true">$</span>
            <input id="ui-price" class="\${inputClass()}" value="49.00">
          </div>
          <div class="\${fieldErrorClass()}"></div>
        </div>
      </div>
    </fieldset>
  `,

  'description-list': `
    <dl class="\${descriptionListClass({ layout: 'inline' })}">
      <div class="\${descriptionRowClass({ layout: 'inline' })}">
        <dt class="\${descriptionTermClass()}">Carrier</dt>
        <dd class="\${descriptionDetailsClass()}">Northwind Freight</dd>
      </div>
      <div class="\${descriptionRowClass({ layout: 'inline' })}">
        <dt class="\${descriptionTermClass()}">Tracking</dt>
        <dd class="\${descriptionDetailsClass()}">NW-4471-QT</dd>
      </div>
    </dl>
  `,

  timeline: `
    <ol class="\${timelineClass()}">
      <li class="\${timelineItemClass()}">
        <span class="\${timelineMarkerClass({ variant: 'success' })}" aria-hidden="true"></span>
        <span class="\${timelineConnectorClass()}" aria-hidden="true"></span>
        <div class="\${timelineContentClass()}">
          <p class="\${timelineTitleClass()}">Delivered to Bristol depot</p>
          <time class="\${timelineTimeClass()}" datetime="2026-08-14T09:24:00Z">09:24</time>
        </div>
      </li>
      <li class="\${timelineItemClass()}">
        <span class="\${timelineMarkerClass({ variant: 'destructive' })}" aria-hidden="true"></span>
        <div class="\${timelineContentClass()}">
          <p class="\${timelineTitleClass()}">Delivery failed, retry booked</p>
          <time class="\${timelineTimeClass()}" datetime="2026-08-14T08:02:00Z">08:02</time>
        </div>
      </li>
    </ol>
  `,

  button: `
    <div class="flex flex-wrap items-center gap-3">
      <button class="\${buttonClass()}">Default</button>
      <button class="\${buttonClass({ variant: 'secondary' })}">Secondary</button>
      <button class="\${buttonClass({ variant: 'outline' })}">Outline</button>
      <button class="\${buttonClass({ variant: 'ghost' })}">Ghost</button>
      <button class="\${buttonClass({ variant: 'destructive' })}">Destructive</button>
      <button class="\${buttonClass({ variant: 'link' })}">Link</button>
    </div>
  `,

  badge: `
    <div class="flex flex-wrap items-center gap-2">
      <span class="\${badgeClass()}">Default</span>
      <span class="\${badgeClass({ variant: 'secondary' })}">Secondary</span>
      <span class="\${badgeClass({ variant: 'destructive' })}">Destructive</span>
      <span class="\${badgeClass({ variant: 'outline' })}">Outline</span>
      <span class="\${badgeClass({ variant: 'ghost' })}">Ghost</span>
      <span class="\${badgeClass({ variant: 'link' })}">Link</span>
    </div>
  `,

  alert: `
    <div role="alert" class="\${alertClass()}">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <div data-slot="alert-title" class="\${alertTitleClass()}">Heads up!</div>
      <div data-slot="alert-description" class="\${alertDescriptionClass()}">You can add components to your app using the cli.</div>
    </div>
  `,

  card: `
    <div class="\${cardClass()} w-full max-w-sm">
      <div class="\${cardHeaderClass()}">
        <div class="\${cardTitleClass()}">Create project</div>
        <div class="\${cardDescriptionClass()}">Deploy your new project in one-click.</div>
      </div>
      <div class="\${cardContentClass()}">
        <div class="\${fieldClass()}">
          <label class="\${labelClass()}" for="card-name">Name</label>
          <input class="\${inputClass()}" id="card-name" placeholder="Name of your project">
        </div>
      </div>
      <div class="\${cardFooterClass()} justify-end gap-2">
        <button class="\${buttonClass({ variant: 'outline' })}">Cancel</button>
        <button class="\${buttonClass()}">Deploy</button>
      </div>
    </div>
  `,

  input: `
    <div class="\${fieldClass()} max-w-sm w-full">
      <label class="\${labelClass()}" for="email">Email</label>
      <input class="\${inputClass()}" id="email" name="email" type="email" placeholder="you@example.com" aria-describedby="email-hint">
      <p class="\${hintClass()}" id="email-hint">We'll never share it.</p>
    </div>
  `,

  textarea: `
    <div class="\${fieldClass()} max-w-md w-full">
      <label class="\${labelClass()}" for="message">Message</label>
      <textarea class="\${textareaClass()}" id="message" name="message" rows="4" placeholder="Tell us how it's going…"></textarea>
    </div>
  `,

  label: `
    <div class="\${fieldClass()}">
      <label class="\${labelClass()}" for="lbl-demo">Accept terms</label>
      <input type="checkbox" id="lbl-demo" class="\${checkboxClass()}" data-slot="checkbox">
    </div>
  `,

  checkbox: `
    <div class="flex items-center gap-2">
      <input type="checkbox" id="cb-1" class="\${checkboxClass()}" data-slot="checkbox" checked>
      <label class="\${labelClass()}" for="cb-1">Subscribe to newsletter</label>
    </div>
  `,

  switch: `
    <label class="flex items-center gap-2">
      <input type="checkbox" role="switch" class="\${switchInputClass()}" name="notify" checked>
      <span class="\${switchTrackClass()}"></span>
      <span class="\${labelClass()}">Notifications</span>
    </label>
  `,

  radio_group: `
    <span class="\${labelClass()}" id="ex-plan-label">Billing plan</span>
    <div role="radiogroup" aria-labelledby="ex-plan-label" class="\${radioGroupClass()}">
      <div class="flex items-center gap-2">
        <input type="radio" name="plan" value="basic" id="plan-basic" class="\${radioClass()}" data-slot="radio" checked>
        <label class="\${labelClass()}" for="plan-basic">Basic</label>
      </div>
      <div class="flex items-center gap-2">
        <input type="radio" name="plan" value="pro" id="plan-pro" class="\${radioClass()}" data-slot="radio">
        <label class="\${labelClass()}" for="plan-pro">Pro</label>
      </div>
    </div>
  `,

  'native-select': `
    <label class="\${labelClass()}" for="ex-native-plan">Billing plan</label>
    <div class="\${nativeSelectWrapperClass()}">
      <select class="\${nativeSelectClass()}" name="plan" id="ex-native-plan">
        <option>Basic</option>
        <option>Pro</option>
        <option>Enterprise</option>
      </select>
      <svg class="\${nativeSelectIconClass()}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  `,

  avatar: `
    <div class="flex items-center gap-3">
      <span class="\${avatarClass()}" data-size="default" data-slot="avatar">
        <img class="\${avatarImageClass()}" src="https://github.com/vivek7405.png" alt="Avatar of Vivek, webjs project owner">
        <span class="\${avatarFallbackClass()}">V</span>
      </span>
      <div class="\${avatarGroupClass()}">
        <span class="\${avatarClass()}" data-size="default" data-slot="avatar">
          <span class="\${avatarFallbackClass()}">A</span>
        </span>
        <span class="\${avatarClass()}" data-size="default" data-slot="avatar">
          <span class="\${avatarFallbackClass()}">B</span>
        </span>
        <span class="\${avatarClass()}" data-size="default" data-slot="avatar">
          <span class="\${avatarFallbackClass()}">C</span>
        </span>
      </div>
    </div>
  `,

  separator: `
    <div class="w-64">
      <div>Above</div>
      <div role="none" class="\${separatorClass()} my-3" data-orientation="horizontal"></div>
      <div>Below</div>
    </div>
  `,

  skeleton: `
    <div class="flex flex-col gap-3 w-full max-w-sm">
      <div class="\${skeletonClass()} h-4 w-3/4"></div>
      <div class="\${skeletonClass()} h-4 w-1/2"></div>
      <div class="\${skeletonClass()} h-4 w-2/3"></div>
    </div>
  `,

  'aspect-ratio': `
    <div style="aspect-ratio: 16 / 9;" class="\${aspectRatioClass()} max-w-md rounded-md bg-muted flex items-center justify-center text-muted-foreground">
      16:9
    </div>
  `,

  kbd: `
    <div class="\${kbdGroupClass()}" role="img" aria-label="Command Shift P">
      <kbd class="\${kbdClass()}">⌘</kbd>
      <kbd class="\${kbdClass()}">Shift</kbd>
      <kbd class="\${kbdClass()}">P</kbd>
    </div>
  `,

  progress: `
    <div class="w-64">
      <progress value="42" max="100" class="\${progressClass()}"></progress>
    </div>
  `,

  table: `
    <div class="\${tableContainerClass()} max-w-md w-full">
      <table class="\${tableClass()}">
        <caption class="\${tableCaptionClass()}">Recent invoices</caption>
        <thead class="\${tableHeaderClass()}">
          <tr class="\${tableRowClass()}">
            <th scope="col" class="\${tableHeadClass()}">Invoice</th>
            <th scope="col" class="\${tableHeadClass()}">Status</th>
            <th scope="col" class="\${tableHeadClass()} text-right">Amount</th>
          </tr>
        </thead>
        <tbody class="\${tableBodyClass()}">
          <tr class="\${tableRowClass()}">
            <td class="\${tableCellClass()}">INV001</td>
            <td class="\${tableCellClass()}">Paid</td>
            <td class="\${tableCellClass()} text-right">$250.00</td>
          </tr>
          <tr class="\${tableRowClass()}">
            <td class="\${tableCellClass()}">INV002</td>
            <td class="\${tableCellClass()}">Pending</td>
            <td class="\${tableCellClass()} text-right">$150.00</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,

  toggle: `
    <ui-toggle aria-label="Toggle italic">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
    </ui-toggle>
  `,

  'toggle-group': `
    <ui-toggle-group type="single" value="center">
      <ui-toggle-group-item value="left" aria-label="Left">L</ui-toggle-group-item>
      <ui-toggle-group-item value="center" aria-label="Center">C</ui-toggle-group-item>
      <ui-toggle-group-item value="right" aria-label="Right">R</ui-toggle-group-item>
    </ui-toggle-group>
  `,

  breadcrumb: `
    <nav aria-label="breadcrumb" data-slot="breadcrumb">
      <ol class="\${breadcrumbListClass()}">
        <li class="\${breadcrumbItemClass()}"><a class="\${breadcrumbLinkClass()}" href="#">Home</a></li>
        <li class="\${breadcrumbSeparatorClass()}" role="presentation" aria-hidden="true">/</li>
        <li class="\${breadcrumbItemClass()}"><a class="\${breadcrumbLinkClass()}" href="#">Docs</a></li>
        <li class="\${breadcrumbSeparatorClass()}" role="presentation" aria-hidden="true">/</li>
        <li class="\${breadcrumbItemClass()}"><span class="\${breadcrumbPageClass()}" aria-current="page">Components</span></li>
      </ol>
    </nav>
  `,

  pagination: `
    <nav role="navigation" aria-label="pagination" class="\${paginationClass()}">
      <ul class="\${paginationContentClass()}">
        <li><a class="\${paginationPreviousClass()}" href="#">‹ Previous</a></li>
        <li><a class="\${paginationLinkClass()}" href="#">1</a></li>
        <li><a class="\${paginationLinkClass({ isActive: true })}" aria-current="page">2</a></li>
        <li><a class="\${paginationLinkClass()}" href="#">3</a></li>
        <li><a class="\${paginationNextClass()}" href="#">Next ›</a></li>
      </ul>
    </nav>
  `,

  // ------------------------------------------------------------------------
  // Tier-2 examples (custom elements)
  // ------------------------------------------------------------------------

  dialog: `
    <ui-dialog>
      <ui-dialog-trigger>
        <button class="\${buttonClass({ variant: 'outline' })}">Open dialog</button>
      </ui-dialog-trigger>
      <ui-dialog-content>
        <div class="\${dialogHeaderClass()}">
          <h2 class="\${dialogTitleClass()}">Edit profile</h2>
          <p class="\${dialogDescriptionClass()}">Make changes to your profile here.</p>
        </div>
        <div class="\${fieldClass()}">
          <label class="\${labelClass()}" for="dlg-name">Name</label>
          <input class="\${inputClass()}" id="dlg-name" placeholder="Your name">
        </div>
        <div class="\${dialogFooterClass()}">
          <ui-dialog-close><button class="\${buttonClass({ variant: 'outline' })}">Cancel</button></ui-dialog-close>
          <button class="\${buttonClass()}">Save</button>
        </div>
      </ui-dialog-content>
    </ui-dialog>
  `,

  alert_dialog: `
    <ui-alert-dialog>
      <ui-alert-dialog-trigger>
        <button class="\${buttonClass({ variant: 'destructive' })}">Delete account</button>
      </ui-alert-dialog-trigger>
      <ui-alert-dialog-content>
        <div class="\${alertDialogHeaderClass()}">
          <h2 class="\${alertDialogTitleClass()}">Are you sure?</h2>
          <p class="\${alertDialogDescriptionClass()}">This action cannot be undone.</p>
        </div>
        <div class="\${alertDialogFooterClass()}">
          <ui-alert-dialog-cancel>Cancel</ui-alert-dialog-cancel>
          <ui-alert-dialog-action variant="destructive">Yes, delete</ui-alert-dialog-action>
        </div>
      </ui-alert-dialog-content>
    </ui-alert-dialog>
  `,

  popover: `
    <button popovertarget="ex-popover" aria-haspopup="dialog" aria-expanded="false" class="\${buttonClass({ variant: 'outline' })}">Open popover</button>
    <div popover id="ex-popover" role="dialog" aria-labelledby="ex-popover-title" aria-describedby="ex-popover-desc" class="\${popoverContentClass({ side: 'bottom', align: 'start', sideOffset: 4 })}">
      <div class="\${popoverHeaderClass()}">
        <h3 class="\${popoverTitleClass()}" id="ex-popover-title">Filter</h3>
        <p class="\${popoverDescriptionClass()}" id="ex-popover-desc">Tag and status.</p>
      </div>
      <div class="\${stackClass({ gap: 'sm' })} mt-3">
        <label class="\${labelClass()}" for="ex-popover-status">Status</label>
        <select class="\${nativeSelectClass()}" id="ex-popover-status"><option>Open</option><option>Closed</option></select>
      </div>
    </div>
  `,

  tooltip: `
    <ui-tooltip delay-duration="200">
      <ui-tooltip-trigger>
        <button class="\${buttonClass({ variant: 'outline', size: 'icon' })}" aria-label="Help">?</button>
      </ui-tooltip-trigger>
      <ui-tooltip-content side="top">Helpful tip appears on hover</ui-tooltip-content>
    </ui-tooltip>
  `,

  'hover-card': `
    <ui-hover-card open-delay="300" close-delay="200">
      <ui-hover-card-trigger>
        <a class="\${buttonClass({ variant: 'link' })}" href="#">@vivek</a>
      </ui-hover-card-trigger>
      <ui-hover-card-content>
        <div class="flex gap-3">
          <span class="\${avatarClass()}" data-size="default">
            <span class="\${avatarFallbackClass()}">V</span>
          </span>
          <div>
            <h4 class="font-semibold">@vivek</h4>
            <p class="text-sm text-muted-foreground">Building webjs.</p>
          </div>
        </div>
      </ui-hover-card-content>
    </ui-hover-card>
  `,

  tabs: `
    <ui-tabs value="account" class="w-full max-w-md">
      <ui-tabs-list>
        <ui-tabs-trigger value="account">Account</ui-tabs-trigger>
        <ui-tabs-trigger value="password">Password</ui-tabs-trigger>
      </ui-tabs-list>
      <ui-tabs-content value="account" class="\${cardClass()} mt-3 p-6">
        <h3 class="\${cardTitleClass()}">Account</h3>
        <p class="\${cardDescriptionClass()} mt-1">Manage your account settings.</p>
      </ui-tabs-content>
      <ui-tabs-content value="password" class="\${cardClass()} mt-3 p-6">
        <h3 class="\${cardTitleClass()}">Password</h3>
        <p class="\${cardDescriptionClass()} mt-1">Change your password here.</p>
      </ui-tabs-content>
    </ui-tabs>
  `,

  accordion: `
    <div class="\${accordionClass()} max-w-md">
      <details name="ex-accordion" class="\${accordionItemClass()}">
        <summary class="\${accordionTriggerClass()}">
          <span>Is it accessible?</span>
          <svg class="size-4 shrink-0 transition-transform group-open:rotate-180"
               xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </summary>
        <div class="\${accordionContentClass()}">Yes. Native disclosure widget pattern.</div>
      </details>
      <details name="ex-accordion" class="\${accordionItemClass()}">
        <summary class="\${accordionTriggerClass()}">
          <span>Is it styled?</span>
          <svg class="size-4 shrink-0 transition-transform group-open:rotate-180"
               xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </summary>
        <div class="\${accordionContentClass()}">Yes. Matches shadcn design tokens.</div>
      </details>
    </div>
  `,

  collapsible: `
    <details class="\${collapsibleClass()} max-w-md">
      <summary class="\${collapsibleTriggerClass()} \${buttonClass({ variant: 'outline' })}">
        Show / Hide details
        <svg class="size-4 transition-transform group-open:rotate-180"
             xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </summary>
      <div class="\${collapsibleContentClass()} mt-3 rounded-md border p-4">
        Hidden content revealed when the disclosure widget opens. Real content, real DOM.
      </div>
    </details>
  `,

  'dropdown-menu': `
    <ui-dropdown-menu>
      <ui-dropdown-menu-trigger>
        <button class="\${buttonClass({ variant: 'outline' })}">Open menu</button>
      </ui-dropdown-menu-trigger>
      <ui-dropdown-menu-content align="start">
        <ui-dropdown-menu-label>My Account</ui-dropdown-menu-label>
        <ui-dropdown-menu-separator></ui-dropdown-menu-separator>
        <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
        <ui-dropdown-menu-item>Billing</ui-dropdown-menu-item>
        <ui-dropdown-menu-sub>
          <ui-dropdown-menu-sub-trigger>Invite users</ui-dropdown-menu-sub-trigger>
          <ui-dropdown-menu-sub-content>
            <ui-dropdown-menu-item>Email</ui-dropdown-menu-item>
            <ui-dropdown-menu-item>Message</ui-dropdown-menu-item>
            <ui-dropdown-menu-separator></ui-dropdown-menu-separator>
            <ui-dropdown-menu-item>More…</ui-dropdown-menu-item>
          </ui-dropdown-menu-sub-content>
        </ui-dropdown-menu-sub>
        <ui-dropdown-menu-item>Settings</ui-dropdown-menu-item>
        <ui-dropdown-menu-separator></ui-dropdown-menu-separator>
        <ui-dropdown-menu-item variant="destructive">Sign out</ui-dropdown-menu-item>
      </ui-dropdown-menu-content>
    </ui-dropdown-menu>
  `,

  sonner: `
    <div class="flex flex-col items-center gap-3">
      <ui-sonner position="bottom-right"></ui-sonner>
      <button class="\${buttonClass({ variant: 'outline' })}" onclick="import('/modules/ui/components/sonner.ts').then(m => m.toast.success('Saved!', {description: 'Your changes were saved.'}))">Show toast</button>
    </div>
  `,
};

// Aliases, registry uses hyphens; some keys use underscores to avoid TS
// reserved-word collisions in the JSON file.
const HYPHENATED_ALIASES: Record<string, string> = {
  'alert-dialog': 'alert_dialog',
  'radio-group': 'radio_group',
};

export function getExample(name: string): string | null {
  const key = HYPHENATED_ALIASES[name] || name;
  return EXAMPLES[key] || null;
}

// ---------------------------------------------------------------------------
// Per-variant + per-size example snippets, one per key, used by the
// component docs page to render a stack of <ComponentPreview>-style cards
// under "Variants" and "Sizes" headings, mirroring shadcn's docs.
//
// Keys match COMPONENT_API[name].variants / .sizes in component-api.ts.
// Lookups go through getVariantExamples(name) / getSizeExamples(name)
// which also handles the hyphen-aliased keys (alert-dialog, etc.).
// ---------------------------------------------------------------------------

// 24x24 lucide-style settings cog used by the icon-size button samples.
const ICON_SETTINGS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

const VARIANT_EXAMPLES: Record<string, Record<string, string>> = {
  // Each button's text IS the variant key so the combined preview pane
  // reads "Default | Destructive | Outline | Secondary | Ghost | Link"
  // without any extra annotation. Same principle for badge, toggle,
  // alert below, when a section shows multiple values side-by-side
  // and the values' visual difference is what's being demonstrated,
  // the text content should name the value rather than be generic.
  button: {
    default: `<button class="\${buttonClass({ variant: 'default' })}">Default</button>`,
    destructive: `<button class="\${buttonClass({ variant: 'destructive' })}">Destructive</button>`,
    outline: `<button class="\${buttonClass({ variant: 'outline' })}">Outline</button>`,
    secondary: `<button class="\${buttonClass({ variant: 'secondary' })}">Secondary</button>`,
    ghost: `<button class="\${buttonClass({ variant: 'ghost' })}">Ghost</button>`,
    link: `<button class="\${buttonClass({ variant: 'link' })}">Link</button>`,
  },
  badge: {
    default: `<span class="\${badgeClass({ variant: 'default' })}">Default</span>`,
    secondary: `<span class="\${badgeClass({ variant: 'secondary' })}">Secondary</span>`,
    destructive: `<span class="\${badgeClass({ variant: 'destructive' })}">Destructive</span>`,
    outline: `<span class="\${badgeClass({ variant: 'outline' })}">Outline</span>`,
    ghost: `<span class="\${badgeClass({ variant: 'ghost' })}">Ghost</span>`,
    link: `<span class="\${badgeClass({ variant: 'link' })}">Link</span>`,
  },
  alert: {
    default: `
      <div class="\${alertClass({ variant: 'default' })} max-w-md">
        <h5 class="\${alertTitleClass()}">Default</h5>
        <p class="\${alertDescriptionClass()}">You can add components to your app using the CLI.</p>
      </div>
    `,
    destructive: `
      <div class="\${alertClass({ variant: 'destructive' })} max-w-md">
        <h5 class="\${alertTitleClass()}">Destructive</h5>
        <p class="\${alertDescriptionClass()}">Your session has expired. Please log in again.</p>
      </div>
    `,
  },
  // <ui-toggle> for interactivity AND to show the variant-specific
  // styling (default = transparent until pressed; outline = always
  // shows border + shadow). Previously these were static <button>s
  // both stuck in data-state=on, which painted bg-accent on both , 
  // visually identical. Now they start unpressed so the structural
  // differences (border on outline, none on default) are visible,
  // and clicking each toggles the pressed state.
  toggle: {
    default: `<ui-toggle variant="default" aria-label="Toggle default">Default</ui-toggle>`,
    outline: `<ui-toggle variant="outline" aria-label="Toggle outline">Outline</ui-toggle>`,
  },
  tabs: {
    default: `
      <ui-tabs value="account" class="w-full max-w-sm">
        <ui-tabs-list variant="default">
          <ui-tabs-trigger value="account">Account</ui-tabs-trigger>
          <ui-tabs-trigger value="password">Password</ui-tabs-trigger>
        </ui-tabs-list>
      </ui-tabs>
    `,
    underline: `
      <ui-tabs value="account" class="w-full max-w-sm">
        <ui-tabs-list variant="underline">
          <ui-tabs-trigger value="account">Account</ui-tabs-trigger>
          <ui-tabs-trigger value="password">Password</ui-tabs-trigger>
        </ui-tabs-list>
      </ui-tabs>
    `,
  },
  'radio-group': {
    vertical: `
      <span class="\${labelClass()}" id="ex-plan-v-label">Billing plan</span>
      <div role="radiogroup" aria-labelledby="ex-plan-v-label" class="\${radioGroupClass({ orientation: 'vertical' })}">
        <div class="flex items-center gap-2">
          <input type="radio" name="plan-v" id="plan-v-basic" data-slot="radio" class="\${radioClass()}" checked>
          <label class="\${labelClass()}" for="plan-v-basic">Basic</label>
        </div>
        <div class="flex items-center gap-2">
          <input type="radio" name="plan-v" id="plan-v-pro" data-slot="radio" class="\${radioClass()}">
          <label class="\${labelClass()}" for="plan-v-pro">Pro</label>
        </div>
        <div class="flex items-center gap-2">
          <input type="radio" name="plan-v" id="plan-v-enterprise" data-slot="radio" class="\${radioClass()}">
          <label class="\${labelClass()}" for="plan-v-enterprise">Enterprise</label>
        </div>
      </div>
    `,
    horizontal: `
      <span class="\${labelClass()}" id="ex-plan-h-label">Billing plan</span>
      <div role="radiogroup" aria-labelledby="ex-plan-h-label" class="\${radioGroupClass({ orientation: 'horizontal' })}">
        <div class="flex items-center gap-2">
          <input type="radio" name="plan-h" id="plan-h-basic" data-slot="radio" class="\${radioClass()}" checked>
          <label class="\${labelClass()}" for="plan-h-basic">Basic</label>
        </div>
        <div class="flex items-center gap-2">
          <input type="radio" name="plan-h" id="plan-h-pro" data-slot="radio" class="\${radioClass()}">
          <label class="\${labelClass()}" for="plan-h-pro">Pro</label>
        </div>
        <div class="flex items-center gap-2">
          <input type="radio" name="plan-h" id="plan-h-enterprise" data-slot="radio" class="\${radioClass()}">
          <label class="\${labelClass()}" for="plan-h-enterprise">Enterprise</label>
        </div>
      </div>
    `,
  },
  // Each variant card renders a real interactive <ui-dropdown-menu>
  // with a trigger button, clicking opens the actual menu (matches
  // the hero preview's pattern). Previously these were STATIC popover
  // cards with bare <ui-dropdown-menu-item> orphans floating inside , 
  // the click handler couldn't close any enclosing menu (there was
  // none), the popover positioning code didn't run, and roving focus
  // had nothing to rove on. Now each card is an authentic mini-menu
  // with one item, and the per-card heading ("Default" / "Destructive")
  // names the variant the inner item is using.
  'dropdown-menu': {
    default: `
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger>
          <button class="\${buttonClass({ variant: 'outline' })}">Open menu</button>
        </ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content align="start">
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `,
    destructive: `
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger>
          <button class="\${buttonClass({ variant: 'outline' })}">Open menu</button>
        </ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content align="start">
          <ui-dropdown-menu-item variant="destructive">Sign out</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `,
  },
  // toggle-group variant + size are root-level attributes that
  // propagate to items. Each card shows a full 3-item group so the
  // cascade is visible.
  'toggle-group': {
    default: `
      <ui-toggle-group type="single" variant="default" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
        <ui-toggle-group-item value="underline">U</ui-toggle-group-item>
      </ui-toggle-group>
    `,
    outline: `
      <ui-toggle-group type="single" variant="outline" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
        <ui-toggle-group-item value="underline">U</ui-toggle-group-item>
      </ui-toggle-group>
    `,
  },
  // separator's variants ARE orientations. The separatorClass()
  // utility outputs `data-[orientation=…]:h-px` / `w-px` selectors,
  // so the element MUST carry a matching data-orientation attribute , 
  // without it the bg-color paints but width/height stay 0 and the
  // separator vanishes. Add data-orientation explicitly to each demo.
  // (shadcn's React Separator sets this attribute via the orientation
  // prop automatically; our class-helper API leaves it to the author.)
  separator: {
    horizontal: `
      <div class="w-64">
        <div class="text-sm pb-2">Section A</div>
        <div class="\${separatorClass({ orientation: 'horizontal' })}" role="separator" data-orientation="horizontal"></div>
        <div class="text-sm pt-2">Section B</div>
      </div>
    `,
    vertical: `
      <div class="flex h-12 items-center gap-3">
        <div class="text-sm">Left</div>
        <div class="\${separatorClass({ orientation: 'vertical' })}" role="separator" data-orientation="vertical"></div>
        <div class="text-sm">Right</div>
      </div>
    `,
  },
};

const SIZE_EXAMPLES: Record<string, Record<string, string>> = {
  // Button text = size key (xs / sm / default / lg). Icon-sized buttons
  // are intentionally NOT in this map, they're demoed in
  // ICON_SIZE_EXAMPLES below so the Sizes section stays consistent
  // (text buttons whose height varies) and the Icon section stays
  // consistent (cog icons whose box varies, no label text).
  button: {
    xs: `<button class="\${buttonClass({ size: 'xs' })}">xs</button>`,
    sm: `<button class="\${buttonClass({ size: 'sm' })}">sm</button>`,
    default: `<button class="\${buttonClass({ size: 'default' })}">default</button>`,
    lg: `<button class="\${buttonClass({ size: 'lg' })}">lg</button>`,
  },
  // Avatar fallback letter = first letter of size name so the three
  // sizes are distinguishable at a glance (S / M / L) on top of the
  // visual diameter cue.
  avatar: {
    sm: `<span class="\${avatarClass({ size: 'sm' })}" data-size="sm"><span class="\${avatarFallbackClass()}">S</span></span>`,
    default: `<span class="\${avatarClass({ size: 'default' })}" data-size="default"><span class="\${avatarFallbackClass()}">M</span></span>`,
    lg: `<span class="\${avatarClass({ size: 'lg' })}" data-size="lg"><span class="\${avatarFallbackClass()}">L</span></span>`,
  },
  switch: {
    default: `
      <label class="inline-flex items-center gap-2">
        <input type="checkbox" data-slot="switch" class="\${switchInputClass()}" checked>
        <span class="\${switchTrackClass({ size: 'default' })}"></span>
        <span class="\${labelClass()}">Default</span>
      </label>
    `,
    sm: `
      <label class="inline-flex items-center gap-2">
        <input type="checkbox" data-slot="switch" class="\${switchInputClass()}" checked>
        <span class="\${switchTrackClass({ size: 'sm' })}"></span>
        <span class="\${labelClass()}">Small</span>
      </label>
    `,
  },
  // Same <ui-toggle> rationale as variants, interactive + the size
  // attribute propagates via the class helper called from
  // _applyClass(). Outline variant chosen so the size diff (border
  // box height) reads at a glance.
  toggle: {
    sm: `<ui-toggle variant="outline" size="sm" aria-label="Toggle sm">sm</ui-toggle>`,
    default: `<ui-toggle variant="outline" size="default" aria-label="Toggle default">default</ui-toggle>`,
    lg: `<ui-toggle variant="outline" size="lg" aria-label="Toggle lg">lg</ui-toggle>`,
  },
  'native-select': {
    default: `
      <div class="\${nativeSelectWrapperClass()}">
        <select class="\${nativeSelectClass()}" data-size="default">
          <option>Default</option><option>Other</option>
        </select>
        <svg class="\${nativeSelectIconClass()}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    `,
    sm: `
      <div class="\${nativeSelectWrapperClass()}">
        <select class="\${nativeSelectClass()}" data-size="sm">
          <option>Small</option><option>Other</option>
        </select>
        <svg class="\${nativeSelectIconClass()}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    `,
  },
  // Card size cascades through Header / Title / Content / Footer via
  // group-data-[size=...]/card. Set data-size on the host so the
  // child helpers pick up the compact layout.
  card: {
    default: `
      <div class="\${cardClass({ size: 'default' })} w-72" data-slot="card" data-size="default">
        <div class="\${cardHeaderClass()}">
          <div class="\${cardTitleClass()}">Notifications</div>
          <div class="\${cardDescriptionClass()}">You have 3 unread.</div>
        </div>
        <div class="\${cardContentClass()}">Default size, gap-6 / py-6 / px-6.</div>
      </div>
    `,
    sm: `
      <div class="\${cardClass({ size: 'sm' })} w-72" data-slot="card" data-size="sm">
        <div class="\${cardHeaderClass()}">
          <div class="\${cardTitleClass()}">Notifications</div>
          <div class="\${cardDescriptionClass()}">You have 3 unread.</div>
        </div>
        <div class="\${cardContentClass()}">Small size, gap-3 / py-3 / px-4.</div>
      </div>
    `,
  },
  // toggle-group size attribute propagates to every item.
  'toggle-group': {
    default: `
      <ui-toggle-group type="single" size="default" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
        <ui-toggle-group-item value="underline">U</ui-toggle-group-item>
      </ui-toggle-group>
    `,
    sm: `
      <ui-toggle-group type="single" size="sm" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
        <ui-toggle-group-item value="underline">U</ui-toggle-group-item>
      </ui-toggle-group>
    `,
    lg: `
      <ui-toggle-group type="single" size="lg" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
        <ui-toggle-group-item value="underline">U</ui-toggle-group-item>
      </ui-toggle-group>
    `,
  },
  // alert-dialog size preview cards render a real <ui-alert-dialog>
  // each, behind its own trigger button. Clicking the button opens
  // the modal; otherwise it stays closed so the docs page doesn't
  // show floating dialogs at idle. Also demonstrates the new
  // <ui-alert-dialog-action variant="destructive"> + <-cancel> auto-
  // styled button forwarding.
  'alert-dialog': {
    default: `
      <ui-alert-dialog>
        <ui-alert-dialog-trigger>
          <button class="\${buttonClass({ variant: 'outline' })}">Open default</button>
        </ui-alert-dialog-trigger>
        <ui-alert-dialog-content size="default">
          <div class="\${alertDialogHeaderClass()}">
            <h2 class="\${alertDialogTitleClass()}">Are you absolutely sure?</h2>
            <p class="\${alertDialogDescriptionClass()}">This action cannot be undone. This will permanently delete your account.</p>
          </div>
          <div class="\${alertDialogFooterClass()}">
            <ui-alert-dialog-cancel>Cancel</ui-alert-dialog-cancel>
            <ui-alert-dialog-action variant="destructive">Delete</ui-alert-dialog-action>
          </div>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `,
    sm: `
      <ui-alert-dialog>
        <ui-alert-dialog-trigger>
          <button class="\${buttonClass({ variant: 'outline' })}">Open sm</button>
        </ui-alert-dialog-trigger>
        <ui-alert-dialog-content size="sm">
          <div class="\${alertDialogHeaderClass()}">
            <h2 class="\${alertDialogTitleClass()}">Delete file?</h2>
            <p class="\${alertDialogDescriptionClass()}">Move "report.pdf" to trash?</p>
          </div>
          <div class="\${alertDialogFooterClass()}">
            <ui-alert-dialog-cancel>Cancel</ui-alert-dialog-cancel>
            <ui-alert-dialog-action variant="destructive">Delete</ui-alert-dialog-action>
          </div>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `,
  },
};

// Position demos for sonner, each card mounts its own <ui-sonner> at
// the target position and the Show button calls .addToast() on THAT
// specific viewport (via the public per-instance method, bypassing the
// singleton toaster.add routing). This works around the multi-viewport
// collision: each card's button only ever publishes into its own
// sibling viewport, so the toast lands at the demonstrated position
// every time regardless of which other viewports the page hosts.
function sonnerPositionExamples(): Record<string, string> {
  const make = (position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right') => `
    <div class="flex items-center gap-3">
      <ui-sonner position="${position}"></ui-sonner>
      <button class="\${buttonClass({ variant: 'outline' })}" onclick="this.previousElementSibling.addToast('${position} toast')">Show ${position}</button>
    </div>
  `;
  return {
    'top-left': make('top-left'),
    'top-center': make('top-center'),
    'top-right': make('top-right'),
    'bottom-left': make('bottom-left'),
    'bottom-center': make('bottom-center'),
    'bottom-right': make('bottom-right'),
  };
}

// Variant examples for sonner are TYPE demos, each card fires the
// matching imperative API so the user sees the icon + colour treatment
// for that toast type.
//
// IMPORTANT: <ui-sonner>'s connectedCallback overwrites the singleton
// `toaster.add` reference (see sonner.ts:120), the LAST viewport to
// connect wins for every subsequent toast() call, including ones from
// buttons in OTHER cards (and the hero). Earlier each card used
// position="top-center", which meant: user clicks "Show toast" on the
// hero (which has its own position="bottom-right" viewport mounted
// FIRST), but the toast appears at top-center because one of the
// variant-card viewports mounted later. Fixing the visible symptom
// by pinning every viewport on this page to bottom-right so it
// doesn't matter which one wins, toasts always appear in the same
// place users expect from the default. (Proper multi-viewport
// routing is a separate concern in sonner.ts, deferred.)
function sonnerTypeExamples(): Record<string, string> {
  // Loading toasts default to duration: 0 (sticky) per sonner
  // convention, they're meant to be replaced by a follow-up
  // toast.success / toast.error via toast.promise. A bare
  // toast.loading() in a docs preview would never disappear. So
  // the loading card demos the realistic flow: toast.promise with
  // a fake 2-second Promise that resolves to success. The user
  // sees the loading toast appear, then auto-transition.
  const make = (type: 'default' | 'success' | 'error' | 'info' | 'warning' | 'loading') => {
    if (type === 'loading') {
      return `
        <div class="flex items-center gap-3">
          <ui-sonner position="bottom-right"></ui-sonner>
          <button class="\${buttonClass({ variant: 'outline' })}" onclick="import('/modules/ui/components/sonner.ts').then(m => m.toast.promise(new Promise(r => setTimeout(r, 2000)), { loading: 'Loading…', success: 'Done!', error: 'Failed' }))">Show loading</button>
        </div>
      `;
    }
    return `
      <div class="flex items-center gap-3">
        <ui-sonner position="bottom-right"></ui-sonner>
        <button class="\${buttonClass({ variant: 'outline' })}" onclick="import('/modules/ui/components/sonner.ts').then(m => m.toast${type === 'default' ? '' : '.' + type}('${type[0].toUpperCase() + type.slice(1)} toast', { description: 'Example ${type} toast.' }))">Show ${type}</button>
      </div>
    `;
  };
  return {
    default: make('default'),
    success: make('success'),
    error: make('error'),
    info: make('info'),
    warning: make('warning'),
    loading: make('loading'),
  };
}

/**
 * The two sonner maps are built ON DEMAND rather than assigned at module scope.
 *
 * They used to be module-scope IIFEs, and that single detail made this module
 * "client-effecting" to the elision analyser, which pinned
 * `app/ui/[name]/page.ts` and shipped the whole snippet map plus the API
 * metadata to the browser on all 33 component pages. Nothing there is of any
 * use client-side: a page function never re-runs in the browser, and these
 * strings are consumed during SSR only. Building them inside a function keeps
 * the module inert on load, so the page elides and the browser fetches just
 * the interactive component leaves. See AGENTS.md, the execution model's
 * self-check on page/layout modules in the network tab.
 */
export function getVariantExamples(name: string): Record<string, string> | null {
  const key = HYPHENATED_ALIASES[name] || name;
  if (key === 'sonner') return sonnerTypeExamples();
  return VARIANT_EXAMPLES[key] || VARIANT_EXAMPLES[name] || null;
}

export function getSizeExamples(name: string): Record<string, string> | null {
  // SIZE_EXAMPLES keyed by the hyphenated component name (no underscore
  // aliasing needed since none of the keys here are TS reserved words).
  if (name === 'sonner') return sonnerPositionExamples();
  return SIZE_EXAMPLES[name] || null;
}

// Icon-sized previews, separate map because they're visually distinct
// from text-button sizes (cog icons of varying box sizes, no label
// text) and deserve their own section heading. Currently only button
// has icon-sized variants but the pattern scales to any future
// component that grows an icon-only API.
const ICON_SIZE_EXAMPLES: Record<string, Record<string, string>> = {
  button: {
    'icon-xs': `<button class="\${buttonClass({ size: 'icon-xs' })}" aria-label="Settings">${ICON_SETTINGS}</button>`,
    'icon-sm': `<button class="\${buttonClass({ size: 'icon-sm' })}" aria-label="Settings">${ICON_SETTINGS}</button>`,
    icon: `<button class="\${buttonClass({ size: 'icon' })}" aria-label="Settings">${ICON_SETTINGS}</button>`,
    'icon-lg': `<button class="\${buttonClass({ size: 'icon-lg' })}" aria-label="Settings">${ICON_SETTINGS}</button>`,
  },
};

export function getIconSizeExamples(name: string): Record<string, string> | null {
  return ICON_SIZE_EXAMPLES[name] || null;
}
