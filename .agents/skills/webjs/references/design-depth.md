# Design depth

Load this when `references/design.md` has been applied and the screen needs
more: a palette built from an accent, a component whose variants you are
choosing between, or the finishing pass. The core file is the one to read on
every UI task; this one is on demand.

## Building a palette from an accent

The kit ships a neutral `--primary` on purpose, so an app states its own brand.
`webjsui init --accent <name>` sets it, and everything below is what to do when
you are choosing the accent by hand.

**One accent, one neutral, and the semantic roles.** That is a complete palette.
An app with three brand colours has no brand colour, because none of them wins.

**Pick the accent for its 600 step in light and its 400 step in dark.** Those
are the steps that clear 4.5:1 against a white and a near-black page
respectively. Picking a colour you like at 500 and then discovering it fails
contrast on a button is the common way this goes wrong.

**The neutral carries the app.** Most of a screen is `--foreground`,
`--muted-foreground`, `--background`, `--border`. The neutral's temperature is a
real decision: a warm grey (stone, taupe) reads as editorial and human, a cool
grey (slate, zinc) as technical and precise. Match it to the accent's
temperature or the screen looks subtly muddy.

**Semantic roles are not the accent.** Success stays green even when the brand
is green, because a green brand plus a green success state means the reader
cannot tell a saved row from a branded one. Keep them separate.

**Tint the neutral toward the accent, slightly, or not at all.** A neutral with
a few percent of the accent's chroma makes a palette feel deliberate. More than
a few percent and every surface looks stained.

## Choosing between a component's variants

A per-family checklist for the decisions the kit leaves open. The component
headers carry the same guidance at the call site; this is the version you read
while deciding which component to reach for at all.

**Showing one thing among several**

| The reader needs to | Reach for | Not |
|---|---|---|
| compare rows on shared columns | `table` | cards, which cannot be compared |
| consume items one at a time | a list or cards | a table, which implies comparison |
| see every option at once, under about 7 | `radio-group` or `toggle-group` | `native-select`, which hides them |
| pick from many, or search | `native-select` | radios, which do not scale |
| switch between parallel views | `tabs` | an accordion, which implies sequence |
| reveal reference material | `accordion` or `collapsible` | tabs, which imply peers |

**Interrupting**

| Severity | Reach for |
|---|---|
| irreversible, needs a decision now | `alert-dialog` |
| a focused task with an end | `dialog` |
| secondary content attached to a thing | `popover` |
| actions too numerous for the surface | `dropdown-menu` |
| a preview that saves a navigation | `hover-card`, never for anything required |
| confirming something that just happened | `sonner`, never for anything required |
| a persistent condition worth knowing | `alert` |

**State on a control**

| The change | Reach for |
|---|---|
| takes effect immediately | `switch` |
| needs a save button | `checkbox` |
| is one of a mutually exclusive set | `radio-group` |
| is a formatting toggle | `toggle` or `toggle-group` |

## Finishing touches

The pass that separates a screen that works from one that feels finished. Do it
last, after the hierarchy is right, because none of it fixes a flat screen.

**Empty states beyond the primitive.** The first-run empty state, the no-results
state, and the error state are three different messages and want three different
treatments. First run is an invitation and gets the illustration and the primary
action. No results is a dead end and gets a way out, which is usually clearing
the filter. An error is not the reader's fault and gets a retry, never a cheerful
illustration.

**Iconography.** Pick one icon set and stay in it, since two sets at different
stroke weights on one screen is visible even to someone who cannot say why.
Size icons to the text they sit beside rather than to the button. An icon
without a label is only understood when it is a convention (a magnifier, an X,
a hamburger); anything else needs its word.

**Imagery.** Reserve the space before it loads with `aspect-ratio`, so nothing
shifts. Keep one ratio per grid so a row of cards has a common horizon. Where
text sits over an image it needs a scrim rather than a hopeful colour choice,
because the image will change and the text will become unreadable.

**Depth and texture.** A border, a background shift, and a shadow are three ways
to say the same thing, so pick one per boundary rather than stacking them. A
card that has a border AND a shadow AND a tinted background is shouting. Prefer
the background shift, then the border, then the shadow, in that order of
subtlety.

**Borders can often be lighter than you think.** A border at full
`--border` strength on every element makes a screen look like a spreadsheet.
Reach for a lighter alpha, or drop the border entirely and let space group.

**Motion is for continuity, not decoration.** Animate a thing that is moving
from one state to another (a panel opening, an item entering a list) so the
reader can follow it. Do not animate something appearing for the first time,
which merely delays it. Keep it under about 200ms and respect
`prefers-reduced-motion`.

## The three archetypes

Short notes on the screens that go wrong most often.

**A dashboard** is mostly numbers, so it lives or dies on the label-to-value
weight inversion in `stat.ts`. Group stats by what the reader is answering
rather than by what the schema stores. Put the number that triggers action at
the top left, which is where the eye starts. Resist a chart where a number would
do, since a single number badly wants to be a single number.

**A settings form** is long by nature, so it is fillable only if it is grouped.
Four sections with legends beats sixteen fields in a column, because the reader
skips the three sections that do not apply. Put the dangerous section last,
visually separated, and make its action destructive and confirmed. Reserve the
error space so a validation message does not move the control the reader was
about to click.

**A content page** is judged on its measure and its rhythm before anything else.
Hold body text to 60 to 75 characters. Give headings more space above them than
below, so a heading attaches to the section it opens rather than floating
between two. Everything else on the page (a sidebar, a table of contents,
related links) is secondary and should be visibly quieter than the article.
