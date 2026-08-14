# Design gate runbook

How to run the before-and-after comparison that decides whether the design
guidance ships (#1116). This is executed by the repo owner, not by the agent
that wrote the guidance, because the party checking the result must not be the
party being evaluated.

Everything needed is here. Nothing should have to be reconstructed from the
issue.

## What is being measured

Whether an agent building a WebJs app produces better-structured screens when
`references/design.md` is present and routed than when it is not. The artifacts
(the token layer, the primitives, the helper headers) are on both sides, so the
only difference between them is the guidance.

## Before you start

- `bun` or `node` on PATH, and a working `webjs create`.
- A headless agent session you can run a prompt in, with no memory of this repo.
- About an hour. Eighteen runs at three per prompt per side, plus scoring.

## Step 1: cut the two sides

The AFTER side is whatever ref carries the guidance. The BEFORE side is that
same ref with the guidance removed and nothing else changed.

Set it once. Pre-merge that is the feature branch, which is when this gate is
meant to run; after a merge it is `origin/main`.

```sh
REF=origin/feat/ui-design-first-class   # or origin/main, once merged

# after side (guidance present). A branch of its own, because a ref that is
# already checked out in the primary clone cannot be checked out twice.
git worktree add -b gate-after ../gate-after "$REF"

# before side (guidance removed, everything else identical)
git worktree add -b gate-before ../gate-before "$REF"
cd ../gate-before
git rm -r --quiet .agents/skills/webjs/references/design.md \
                  .agents/skills/webjs/references/design-depth.md
# drop the routing rows so nothing points at the deleted files. THREE places:
# SKILL.md's topic table, its "Reach For The Right Primitive" cheat sheet (two
# rows, which a repo-health test pairs against the gallery demos), and the
# reference table in root AGENTS.md.
$EDITOR .agents/skills/webjs/SKILL.md AGENTS.md
git commit -am "gate: before side, guidance removed"
```

Confirm the two sides differ in the guidance and nothing else:

```sh
git diff gate-before..gate-after --stat
```

Anything in that diff other than the two reference files and their routing rows
means the sides are not comparable. Fix it before running.

## Step 2: generate the apps

Nine apps per side: three prompts times three runs. Eighteen in all.

```sh
for side in before after; do
  for prompt in dashboard settings-form content-page; do
    for run in 1 2 3; do
      npx webjs create "gate-$side-$prompt-$run"
    done
  done
done
```

## Step 3: run each prompt

For each generated app, in a FRESH headless session with no prior context:

```sh
cd gate-<side>-<prompt>-<run>
# point the session at this directory, then paste the prompt file verbatim:
cat ../<side-worktree>/scripts/eval-design/prompts/<prompt>.md
```

Rules that make the result mean anything:

- **Fresh session per run.** A session that already built the dashboard carries
  what it learned into the settings form.
- **The prompt verbatim.** No added instruction, no follow-up nudge, no "make it
  look better". If the agent asks a question, answer only about the product, and
  record that you did.
- **Same model and same settings on both sides.** Note which.
- **Let it finish.** A run stopped early is not a run; discard and redo it.

## Step 4: score every run

```sh
node scripts/eval-design.mjs gate-<side>-<prompt>-<run>
# machine-readable, for the table:
node scripts/eval-design.mjs gate-<side>-<prompt>-<run> --json > scores/<side>-<prompt>-<run>.json
```

The script emits nine numbers and a total. It emits no judgment, so a reviewer
can re-run it against either side and get the same reading.

## Step 5: screenshot

For one run per prompt per side (six pairs), capture:

- light theme
- dark theme
- one load with JavaScript disabled

The machine lines cannot see whether a screen reads well, and the JS-disabled
load is what proves the result is progressively enhanced rather than merely
scoring well.

## Step 6: report

Post **every** run's score, not the best one. Three runs per prompt per side is
the minimum, and a single good after-run next to a single bad before-run is not
a result.

Report as a table: side, prompt, run, each of the nine lines, total. Then the
six screenshot pairs. Then your own read of whether the after screens are
actually better, which is the part no number covers.

## Step 7: the decision

- **The after side wins on the rubric lines and regresses none, and the
  screenshots agree.** The guidance ships.
- **The after side does not beat the before side.** The guidance does NOT ship.
  Revert its merge, keep the artifacts, and park the depth reference. Do not
  iterate on the wording hunting for a positive number: the hypothesis was that
  a loaded reference changes what a model already knows, and a null result is
  that hypothesis answered.
- **The after runs provably never loaded the file** (check the session
  transcripts for the read). That measures the routing rather than the content,
  so fix the routing and run the after side once more. This is the only rerun
  the gate allows.
