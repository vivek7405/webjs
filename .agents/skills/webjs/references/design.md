# Designing a screen

`styling.md` covers how to make a class list work in WebJs. This covers what the
screen should look like before you write one. Read it when you are building any
user-facing screen, alongside `styling.md` rather than instead of it.

The rules here are opinionated on purpose. A screen built by following them is
not going to win an award, and it is going to be clearly better than the flat,
evenly-weighted output that comes from having no rules at all.

## The one rule everything else serves

**Not everything can be important.** A screen where every element is the same
weight forces the reader to read all of it to find the part they wanted. Design
is mostly deciding what is primary and then making everything else quieter.

So for every screen, name the one thing the reader came for. Then make it the
loudest thing, and push everything else down.

## Hierarchy

**De-emphasise instead of emphasising.** The reflex when something does not
stand out is to make it bigger or bolder. Do the opposite: make its neighbours
quieter. A screen where one thing is loud reads better than a screen where
everything is competing to be loud.

Three tools, in order of preference:

1. **Colour.** `text-foreground` for primary content, `text-muted-foreground`
   for secondary. This alone carries most of the hierarchy on most screens.
2. **Weight.** `font-medium` or `font-semibold` for the thing that matters,
   normal for everything else. Skip `font-bold` for body text.
3. **Size.** The blunt one, and the one reached for first by habit. A size jump
   is right for a page title and wrong for making a label noticeable.

**Do not use size for something colour can carry.** A label above a value is a
label because it is quieter, not because it is smaller. `stat.ts` and
`description-list.ts` both encode this: the label is `text-sm
text-muted-foreground` and the value is at reading weight or larger.

**Labels are usually unnecessary.** `Sarah Chen` needs no `Name:` in front of
it. When the value's format already says what it is (an email, a date, a price),
drop the label. When you do need one, it goes above or beside the value at lower
weight, never inline with a colon between them.

## The action pyramid

Every screen has exactly one primary action. Not two.

- **Primary**, one per view: `buttonClass()`, the default variant.
- **Secondary**, a few: `buttonClass({ variant: 'secondary' })`, or `'outline'`
  where your copy of the kit has it.
- **Tertiary**, as many as needed: `'ghost'` or `'link'`.

The variant NAMES are whatever your `components/ui/button.ts` declares. It is
copied into your repo and yours to edit, so check it rather than assuming the
set: an app that has trimmed or renamed a variant gets a type error, or an
unstyled button, from a name that was right in someone else's app.

Two default-variant buttons side by side tell the reader nothing about which to
press, so they choose by position. If two actions genuinely feel equal, the
screen has not decided what it is for. Pick one.

**Destructive is not the same as negative.** Cancel is not destructive; it is
tertiary. `variant: 'destructive'` is for the irreversible thing, and it usually
belongs behind a confirmation rather than on the surface.

## Spacing and grouping

**Space groups things, and it does it better than borders do.** Elements close
together read as related and elements far apart read as separate, before the
reader has consciously looked at anything. So group with space first, reach for
a border or a card only when space alone has not carried it, and treat a screen
ruled into boxes as a smell.

**Give labels less space than they take by default.** A label sitting an equal
distance between the field above it and the field below it looks attached to
neither. Tighten the gap to its own field (`gap-1` or `gap-2`) and widen the gap
between fields (`gap-4` or more). This one change fixes most forms.

**Use the scale.** Tailwind's spacing scale exists so a screen has a rhythm.
`p-[13px]` means the number was translated from somewhere rather than chosen,
and a screen full of arbitrary values has no rhythm by construction, however
reasonable each value looks alone.

**Start with too much space and remove it.** Cramped is much harder to fix later
than airy, because cramped reads as broken while airy merely reads as calm.

## Type

**Use the named steps.** `text-sm` through `text-3xl` and so on, never
`text-[15px]`. The scale is what keeps two screens consistent.

**Body text has a measure.** Around 60 to 75 characters per line is where
reading is comfortable, which is roughly `max-w-prose` or `max-w-2xl`. A
paragraph running the full width of a wide screen is genuinely harder to read,
because the eye loses the line on the return sweep.

**Line height varies with size, inversely.** Small text needs more relative
leading (`leading-relaxed`), large headings need less (`leading-tight`). The
default `leading-normal` everywhere is a tell.

**Two weights and two sizes are usually enough for a screen.** A page using five
type sizes has usually confused variety with hierarchy.

## Colour

**Every colour is a token.** Never a hex, never `bg-blue-600`. The kit ships
`--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, plus
`--success`, `--warning` and `--info`, each with a foreground and a subtle
surface pair. An app that names a palette family cannot be rethemed, and the
reader gets one hardcoded green that no longer matches anything around it.

**A `-foreground` token assumes a SOLID fill.** A component that DILUTES that
fill, the way the kit's destructive button does with `dark:bg-destructive/60`,
is painting a different colour and the pair no longer holds: there,
`--destructive-foreground` measures 2.49:1 while plain `text-white` measures
6.48:1. So `button.ts` and `badge.ts` keep `text-white` on that variant. If you
dilute a fill with an opacity modifier, re-measure the foreground against the
composite rather than assuming the token still applies.

**A literal is right where the theme should not move the colour.** A scrim is
the everyday case, and the kit's dialogs use `backdrop:bg-black/50` rather than
a token, because a scrim is black in both themes. The rule is not that a
literal is never correct, it is that a colour is a token whenever the theme
should be able to move it, which is almost always.

**Semantic state goes through the semantic role.** A failed row is
`text-destructive`, not `text-red-600`. A success toast is `text-success`. This
is how the same state stays the same colour across a whole app.

**Colour is never the only signal.** A red dot means nothing to a screen reader
user and is ambiguous to anyone who cannot separate the hues, so state carried
by colour also needs a word or an icon.

**Grey is the workhorse.** Most of a good screen is `--foreground`,
`--muted-foreground` and `--background`, with the accent used sparingly on the
one thing that matters. An app that uses its brand colour everywhere has no
brand colour, because nothing stands out against it.

## Elevation

Use the role scale, `shadow-e1` through `shadow-e4`, rather than the size scale.

- `shadow-e1` raised, a card at rest
- `shadow-e2` menu, a dropdown or a popover
- `shadow-e3` dialog, a modal or a sheet
- `shadow-e4` top, a toast

The role names mean the z-axis says something. `shadow-md` on a card and
`shadow-md` on a dropdown puts two different things on the same plane, which is
how depth stops carrying meaning. Keep peers on one level: a card raised above
its neighbours claims an importance its content probably does not have.

**In dark mode the lift comes from the SURFACE, not the shadow.** A raised
element is lighter than the page behind it, which the theme already expresses
through `--card` and `--popover` sitting above `--background`. So use
`bg-card` for a raised surface and let the shadow only separate its edge. A
shadow doing all the work on a dark ground reads as a hole rather than as
lift, which is why the dark shadow is stronger than the light one but not
dramatically so.

## Empty states are not optional

**A list needs an empty branch, written at the same time as the list.** This is
the most common defect in a generated screen and the easiest to miss, because
seeded development data hides it completely. Every user sees the empty state on
their first day, and a blank region reads as broken rather than as empty.

Use `empty-state.ts`. Say what belongs here, why it is not here yet, and offer
the one action that fills it:

```ts
${rows.length
  ? html`<ul>${rows.map(row)}</ul>`
  : html`<div class=${emptyStateClass()}>
      <h2 class=${emptyStateTitleClass()}>No invoices yet</h2>
      <p class=${emptyStateDescriptionClass()}>Invoices you send appear here.</p>
      <div class=${emptyStateActionsClass()}>
        <button class=${buttonClass()}>Create invoice</button>
      </div>
    </div>`}
```

The same applies to a search with no results, a filter that matches nothing, and
an error state. Each is a different message, so do not render one component for
all three.

## What is WebJs-shaped about any of this

Four places where the framework changes the design decision itself.

**The empty state must be in the first paint.** Pages are server-rendered and do
not hydrate, so an empty state rendered from the page function is there with JS
off. One rendered only after a client fetch is a blank region for everyone whose
JS has not run yet, which includes every first paint. Render the branch on the
server.

**A fallback is a design surface, not a spinner dump.** `<webjs-suspense>`
flushes its `.fallback` on the first byte, so that fallback is a real part of
the screen and often on screen longer than anything else. Give it the shape of
the content it is replacing rather than a centred spinner.

**Polish on a display-only component is free.** A component with no
interactivity signal is elided, so its module never reaches the browser. A
decorative wrapper, a nicer empty state, an extra layer of visual structure
costs the reader nothing to download. There is no performance argument for
leaving a display-only component plain.

**Optimistic pending state is a token, not a per-call-site opacity.** A pending
row wants one consistent treatment across the app. Pick it once and reuse it,
rather than writing `opacity-50` at each call site and drifting.

## Process

**Start greyscale.** Build the whole screen in `--foreground`,
`--muted-foreground` and `--background`, with no accent at all. If the hierarchy
does not work in grey, colour will not fix it, it will only hide it. Add the
accent last, to the one thing that matters most.

**Design the hardest state first.** The longest name, the empty list, the error,
the number with seven digits. A layout built around the happy path breaks the
first time real data arrives.

**Steal structure, not pixels.** When unsure what a screen should look like,
copy the structure of one you know works and fill it with your own content.

## Where to go next

- `references/design-depth.md` for palette construction from an accent, the
  per-component variant checklist, and finishing touches.
- `references/styling.md` for the WebJs mechanics: the light-DOM tag-prefix
  rule, tokens, fixed headers, no-reflow layout.
- `references/components.md` for sizing an island, which is a different question
  from how a screen should look.
