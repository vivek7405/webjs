/**
 * DESIGN EXEMPLAR: a settings form.
 *
 * The companion to the dashboard exemplar. A dashboard goes wrong by making
 * everything equally loud; a long form goes wrong by being an undifferentiated
 * column of inputs that nobody can fill in.
 *
 * The four decisions that matter most here:
 *
 *   1. GROUPING is what makes a long form fillable. Four fieldsets with legends
 *      beats sixteen fields in a column, because the reader can skip the three
 *      sections that do not apply to them.
 *   2. The label-to-field gap is TIGHTER than the field-to-field gap. A label
 *      sitting an equal distance from the field above and the field below looks
 *      attached to neither. This single change fixes most forms.
 *   3. The error space is RESERVED. If the message is inserted on validation
 *      the whole form jumps a line, which moves the control the reader was
 *      about to click, at the exact moment they already got something wrong.
 *   4. The dangerous section is LAST, visually separated, and its action is
 *      destructive and confirmed. Danger does not sit next to something routine.
 *
 * The write path is a bound server action, so it works with JS off. That is not
 * a design decision on top of the framework, it is what the framework does.
 */
import { html } from '@webjsdev/core';
import type { Metadata, PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { inputClass } from '#components/ui/input.ts';
import {
  pageHeaderClass,
  pageHeaderTitleClass,
  pageHeaderDescriptionClass,
} from '#components/ui/page-header.ts';
import {
  fieldSetClass,
  fieldLegendClass,
  fieldGroupClass,
  inputGroupClass,
  inputGroupAddonClass,
  fieldErrorClass,
} from '#components/ui/field-group.ts';
import {
  descriptionListClass,
  descriptionRowClass,
  descriptionTermClass,
  descriptionDetailsClass,
} from '#components/ui/description-list.ts';
import { saveSettings } from '#modules/settings/actions/save-settings.server.ts';

export const metadata: Metadata = {
  title: 'Settings (design exemplar) | examples',
  description: 'What a long form looks like when it is grouped, and where the error message goes.',
};

interface ActionData {
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

/**
 * One field: label, control, and its reserved error space.
 *
 * `gap-1` between the label and its control, against the `gap-4` between
 * fields in the group. That ratio is what makes the label read as belonging to
 * this field rather than floating between two.
 */
function field(opts: {
  name: string;
  label: string;
  value: string;
  error?: string;
  type?: string;
  hint?: string;
  addon?: string;
}) {
  const errorId = `${opts.name}-error`;
  const hintId = `${opts.name}-hint`;
  // aria-describedby points at whichever of the two exist, so the control is
  // described by its hint normally and by its error once there is one.
  const describedBy = [opts.hint ? hintId : null, opts.error ? errorId : null].filter(Boolean).join(' ');
  // `value=` the ATTRIBUTE, never `.value=` the property. A `.prop` hole is
  // dropped at SSR on a native element (it round-trips only on a custom
  // element, via data-webjs-prop-*), and a page never hydrates, so nothing
  // would set it client-side either. The field would render empty and a 422
  // would lose everything typed, which is the opposite of what this file
  // claims to demonstrate.
  // BRANCH the template rather than passing an empty string. A plain-attribute
  // hole stringifies at SSR, so `aria-describedby=${''}` emits
  // `aria-describedby=""`, which is an IDREF list resolving to nothing rather
  // than an absent attribute. There is no nullish value that omits an
  // attribute, so branching is the only way to not emit it.
  const control = describedBy
    ? html`
        <input
          class=${inputClass()}
          id=${opts.name}
          name=${opts.name}
          type=${opts.type ?? 'text'}
          value=${opts.value}
          aria-describedby=${describedBy}
          aria-invalid=${opts.error ? 'true' : 'false'}
        >
      `
    : html`
        <input
          class=${inputClass()}
          id=${opts.name}
          name=${opts.name}
          type=${opts.type ?? 'text'}
          value=${opts.value}
          aria-invalid=${opts.error ? 'true' : 'false'}
        >
      `;
  return html`
    <div class="grid gap-1">
      <label class="text-sm font-medium" for=${opts.name}>${opts.label}</label>
      ${opts.addon
        ? html`<div class=${inputGroupClass()}>
            <!-- The addon is decoration, so it is aria-hidden and the field
                 still carries its own label. An addon is not a label. -->
            <span class=${inputGroupAddonClass({ side: 'start' })} aria-hidden="true">${opts.addon}</span>
            ${control}
          </div>`
        : control}
      ${opts.hint ? html`<p class="text-muted-foreground text-xs" id=${hintId}>${opts.hint}</p>` : ''}
      <!-- Reserved whether or not there is an error. This is the whole point:
           the space exists before the message does. -->
      <div class=${fieldErrorClass()}>
        ${opts.error
          ? html`<p class="text-destructive text-sm font-medium" id=${errorId} aria-live="polite">${opts.error}</p>`
          : ''}
      </div>
    </div>
  `;
}

export default function SettingsExample({ searchParams, actionData }: PageProps) {
  const data = (actionData ?? {}) as ActionData;
  const errors = data.fieldErrors ?? {};
  const values = data.values ?? {};
  const saved = searchParams?.saved === '1' && !data.fieldErrors;

  return html`
    <header class=${pageHeaderClass()}>
      <div>
        <h1 class=${pageHeaderTitleClass()}>Account</h1>
        <p class=${pageHeaderDescriptionClass()}>
          You reach this page about twice a year, so nothing here assumes you remember it.
        </p>
      </div>
    </header>

    <!-- Success is a quiet subtle surface, not a solid fill. A confirmation
         that shouts competes with the form it is confirming. -->
    ${saved
      ? html`<p class="bg-success-subtle text-success-subtle-foreground mb-6 rounded-md px-4 py-3 text-sm"
                 role="status">Your changes are saved.</p>`
      : ''}

    <!-- Binding the action IS the wiring. No method, no enctype, no adapter,
         and it submits with JS off. -->
    <form action=${saveSettings} class="grid max-w-2xl gap-10">
      <fieldset class=${fieldSetClass()}>
        <legend class=${fieldLegendClass()}>Profile</legend>
        <div class=${fieldGroupClass()}>
          ${field({
            name: 'displayName',
            label: 'Display name',
            value: values.displayName ?? 'Sarah Chen',
            error: errors.displayName,
            hint: 'Shown to your team on shared schedules.',
          })}
          ${field({
            name: 'email',
            label: 'Email address',
            type: 'email',
            value: values.email ?? 'sarah@meridiandental.co.uk',
            error: errors.email,
          })}
          ${field({
            name: 'practice',
            label: 'Practice name',
            value: values.practice ?? 'Meridian Dental',
            error: errors.practice,
          })}
          ${field({
            name: 'timezone',
            label: 'Time zone',
            value: values.timezone ?? 'Europe/London',
            error: errors.timezone,
            addon: 'UTC',
          })}
        </div>
      </fieldset>

      <fieldset class=${fieldSetClass()}>
        <legend class=${fieldLegendClass()}>Notifications</legend>
        <!-- A fieldset with a legend is not optional for a group of checkboxes.
             Without it a screen reader announces six options with no idea what
             question they answer. -->
        <div class="grid gap-3">
          ${[
            ['appointment-booked', 'An appointment is booked'],
            ['appointment-cancelled', 'An appointment is cancelled'],
            ['reminder-sent', 'A reminder goes out'],
            ['payment-received', 'A payment arrives'],
            ['staff-added', 'Someone joins the practice'],
            ['weekly-summary', 'The weekly summary'],
          ].map(
            ([name, label]) => html`
              <div class="flex items-center gap-3">
                <input class="size-4" id=${name} name=${name} type="checkbox">
                <!-- Positive wording. "Do not email me" makes the reader work
                     out what ticking it means. -->
                <label class="text-sm" for=${name}>${label}</label>
              </div>
            `,
          )}
        </div>
      </fieldset>

      <fieldset class=${fieldSetClass()}>
        <legend class=${fieldLegendClass()}>Billing</legend>
        <!-- Read-only facts are a description list, not disabled inputs and not
             a label, a colon and a value on one line. The term goes quiet, the
             value stays at reading weight, and the pairing is in the markup.
             (No backticks in here: invariant 9, a backtick inside an html
             template body closes the literal at parse time, even in a comment.
             This exemplar tripped it on the first boot.) -->
        <dl class=${descriptionListClass({ layout: 'inline' })}>
          <div class=${descriptionRowClass({ layout: 'inline' })}>
            <dt class=${descriptionTermClass()}>Plan</dt>
            <dd class=${descriptionDetailsClass()}>Practice, 12 chairs</dd>
          </div>
          <div class=${descriptionRowClass({ layout: 'inline' })}>
            <dt class=${descriptionTermClass()}>Card</dt>
            <dd class=${descriptionDetailsClass()}>Visa ending 4471</dd>
          </div>
          <div class=${descriptionRowClass({ layout: 'inline' })}>
            <dt class=${descriptionTermClass()}>Next charge</dt>
            <dd class=${descriptionDetailsClass()}>
              <time datetime="2026-09-01">1 September 2026</time>, £240
            </dd>
          </div>
        </dl>
        <div>
          <a class=${buttonClass({ variant: 'secondary', size: 'sm' })} href="/examples/settings">Change plan</a>
        </div>
      </fieldset>

      <!-- ONE primary action for the whole form. Cancel is tertiary, not
           destructive: it is not the dangerous one, it is the quiet one. -->
      <div class="flex items-center gap-3">
        <button class=${buttonClass()}>Save changes</button>
        <a class=${buttonClass({ variant: 'ghost' })} href="/examples/settings">Cancel</a>
      </div>
    </form>

    <!-- The dangerous section is last, ruled off, and outside the form above so
         its button can never be the thing an accidental Enter reaches. -->
    <section class="border-destructive/30 mt-12 max-w-2xl rounded-lg border p-6">
      <h2 class="text-base font-medium">Close this account</h2>
      <p class="text-muted-foreground mt-1 text-sm">
        Your practice's data is removed after thirty days. This cannot be undone, and you
        will be asked to type the practice name to confirm.
      </p>
      <div class="mt-4">
        <button class=${buttonClass({ variant: 'destructive' })} type="button">Close account</button>
      </div>
    </section>
  `;
}
