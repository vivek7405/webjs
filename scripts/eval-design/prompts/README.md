# Eval prompts

Three fixed product briefs, one per archetype, used as the input to both sides
of the design gate (#1116). They are committed verbatim and must not be edited
between the before run and the after run, since a changed prompt makes the two
sides incomparable.

## The ban, and why it is the whole point

**No design vocabulary appears in any of these files.** The gate measures
whether an agent reaches for the tokens, the primitives and the reference
without being told to. A brief that asks for a polished screen measures the
brief, not the guidance, and would show an improvement even if the guidance
shipped as an empty file.

Banned outright:

```
beautiful  clean  modern  polished  professional  sleek  elegant  minimal
hierarchy  spacing  layout  palette  color  colour  typography  font
empty state  elevation  shadow  responsive  accessible  design  style
```

Also banned: any mention of `@webjsdev/ui`, the token names, the component
helpers, the skill, or `references/design.md`. The closing line
(`Build this in the WebJs app in this directory.`) is the only framework hint
any prompt carries, and it is identical across all three.

`test/scripts/eval-design.test.mjs` asserts the ban by scanning these files
against that word list, so a later edit cannot quietly contaminate the
instrument. If a brief genuinely needs one of those words to describe the
product (a design tool whose subject matter is typography, say), change the
product rather than the ban.

## Writing a brief

Each file is a heading, three to six sentences of product brief, and the closing
line. Nothing else. The brief states what the product is, who uses it, the
entities and their fields, and the tasks the screen has to support. It never
states how any of it should look.

## Running them

See `../RUNBOOK.md`. The short version is that each prompt is run in a fresh
headless session against a freshly scaffolded app, at least three times per side,
and every run's score is reported rather than the best one.
