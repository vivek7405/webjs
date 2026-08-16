---
name: webjs-doc-sync
description: Use this skill whenever a change ships a user-facing or agent-facing surface (a new export, CLI flag, package.json webjs.* config key, html hole prefix, lifecycle hook, convention, or a behaviour change to an already-documented feature) and the docs must be brought in sync, OR when the user asks to find documentation drift / doc gaps / "did we update the docs", audit shipped work for missing docs, or sync the docs surfaces. The skill carries the authoritative map of EVERY doc surface webjs ships and the change-type to surface mapping, so no surface (the docs site, the marketing website, the skill at `.agents/skills/webjs/`, README, AGENTS.md, the scaffold templates' per-agent rule files) is silently skipped.
when_to_use: |
  Examples that should trigger this skill:
    "we added HTTP verbs for server actions but never updated the docs"
    "sync the docs for the new path-alias feature"
    "find all the doc gaps from recently shipped work"
    "did we update the docs site and website for this?"
    "audit the Done issues for missing documentation"
    finishing any feature whose public/agent-facing surface changed
  Do NOT trigger for: a pure-internal change with no public surface (a
  refactor, CI wiring, a release bump, test stabilization, a perf change
  that does not alter behaviour). Those need no doc update.
---

# Keep every webjs doc surface in sync with shipped behaviour

WebJs ships its documentation across SEVERAL independent surfaces. The recurring
failure mode is updating ONE (usually `AGENTS.md`) and silently missing the rest,
so the docs site, the marketing website, and the scaffold's per-agent rule files
drift behind the framework. HTTP-verb server actions (#488) shipped with
`AGENTS.md` updated but the docs site untouched, which is exactly the gap this
skill exists to close.

This skill is the authoritative map of every surface plus a deterministic
change-type to surface mapping. Use it in two modes: **per-change sync** (a
feature just shipped, bring docs in line) and **audit** (sweep already-shipped
work for drift and file follow-ups).

## The complete doc surface map

Treat this list as the universe. For any change, decide per surface whether it
applies, then update or consciously skip each.

1. **`AGENTS.md`** (repo root) plus the skill at **`.agents/skills/webjs/`**
   (SKILL.md plus its 13 `references/`: `routing-and-pages`, `components`,
   `data-and-actions`, `auth-and-sessions`, `styling`,
   `client-router-and-streaming`, `optimistic-ui`, `typescript`, `testing`,
   `built-ins`, `runtime`, `service-worker`, `muscle-memory-gotchas`).
   `AGENTS.md` stays lean and points at the matching `references/<x>.md` for the
   full reference. A new public API goes in BOTH the `AGENTS.md` summary and the
   relevant `references/` file.
2. **`README.md`** (repo root). Update when a headline capability changes (the
   feature list, the quickstart, the runtime/template matrix).
3. **The docs site: `website/app/docs/<topic>/page.ts`.** This is the
   user-facing documentation at webjs.dev/docs. Find the topic page(s) that cover
   the area (`server-actions`, `routing`, `components`, `caching`, `configuration`,
   `client-router`, `data-fetching`, ...) and update them. `llms.txt` /
   `llms-full.txt` are generated LIVE from the doc pages (no build step), so they
   never need a manual edit. A brand-new capability may need a NEW topic page plus
   a nav entry.
4. **The marketing website: `website/`.** Update landing/feature copy when a
   headline capability changes. The changelog (`website/app/changelog`) is
   auto-generated from conventional PR titles, so NEVER hand-write it; the blog is
   manual.
5. **The scaffold templates: `packages/cli/templates/`.** Every new app ships
   these. The scaffold is single-source: `AGENTS.md` (a thin pointer) plus the one
   cross-agent skill at `.agents/skills/webjs/` (SKILL.md + `references/`) that
   every tool reads. There are no per-agent rule files to keep in lockstep. A
   change to how apps are AUTHORED lands in the skill. When the change is to what
   `webjs create` GENERATES (a gallery/showcase demo, a template, the generated
   layout/home/theme/schema, a scaffold convention), this surface has more parts
   (the `packages/cli/lib/*` generators, the repo-root `gallery/**` app whose
   demos prepack bundles into the CLI, the scaffold tests, the framework
   template-matrix docs, the preview
   apps) and a mandatory `generate + boot + webjs check` step: use the dedicated
   **`webjs-scaffold-sync`** skill for those, and treat this doc-sync entry as the
   docs-only slice. The CLI help text in `packages/cli/` is part of this surface
   for a new command or flag.
6. **Example / dogfood apps** (`examples/blog/CONVENTIONS.md` and friends). Update
   when a convention the example demonstrates changes.

## Change-type to surface mapping

| Change | Surfaces that MUST be checked |
|---|---|
| New / changed public export (`@webjsdev/core` or `/server`), `html` hole prefix, lifecycle hook | AGENTS.md + matching `references/*.md` in the skill + docs site topic page + README if headline |
| New / changed CLI command or flag | AGENTS.md CLI reference + docs site page + README + the CLI `--help` text in `packages/cli/` |
| New `package.json` `webjs.*` config key | AGENTS.md configuration section + the skill's `references/built-ins.md` + docs site `configuration` page + `WebjsConfig` type + the JSON Schema |
| New convention or agent workflow rule | AGENTS.md + repo `CONVENTIONS.md` (if added) + ALL scaffold per-agent rule files in lockstep + the skill's `references/` if relevant |
| Behaviour change to an already-documented feature | EVERY surface that describes the old behaviour (grep the feature's tokens across all surfaces below) |
| New file convention (`*.server.ts`, a routing file) | AGENTS.md file-conventions + docs site `routing` / relevant page + scaffold templates |
| Pure internal (refactor, CI, release, test, perf with no behaviour change) | NONE. Consciously record that no doc surface applies. |

## Per-change sync procedure

The surface checks below are independent reads, so run them fanned out: one read-only `Explore` agent per doc surface, spawned in ONE message, each answering "does this surface describe the changed behavior, and does it still tell the truth at head?". The agents REPORT; the edits stay in the main session, because parallel writers on overlapping docs collide. A single-surface change needs no fan-out.

1. Identify the change's IDENTIFYING TOKENS: the export name, CLI flag, config
   key, file-convention string, or feature phrase a doc would mention.
2. Grep those tokens across every surface to see where the feature is (or should
   be) described:
   ```sh
   git grep -n -iE '<token1>|<token2>' -- \
     AGENTS.md '.agents/skills/webjs/**' README.md 'website/app/docs/**' \
     'website/**' 'packages/cli/templates/**' 'examples/**/CONVENTIONS.md'
   ```
3. For each surface in the mapping that applies, update it. For a behaviour
   CHANGE, every place the OLD behaviour is described must be corrected (the grep
   surfaces them).
4. Verify: re-run the grep and confirm each applicable surface now describes the
   new behaviour, and no surface still describes the old one.
5. Respect the prose-punctuation invariant (#11) and run `webjs check` if any
   code-shaped doc (a `.ts` doc page) changed.

## Audit-mode procedure (sweep shipped work for drift)

An audit is the fan-out's best case: every surface of the map gets its own read-only `Explore` agent, all spawned in one message, so the sweep costs the slowest surface rather than the sum. Reads fan out, writes stay here.

Use this to find existing gaps (for example, across the Done items on the project
board):

1. Build the candidate list: the shipped changes whose surface is user-facing or
   agent-facing (`feat:` / behaviour-changing `fix:` / new CLI / new config /
   new convention). Skip pure-internal items (CI, release, refactor, test
   stabilization, perf-only).
2. For each candidate, read what it introduced (the issue body / merged PR), pull
   its identifying tokens, and run the surface grep above.
3. A surface is a GAP when the mapping says it applies but the grep finds the
   feature absent (or describing stale behaviour) there. A feature documented only
   in `AGENTS.md` with a docs-site topic page that never mentions it is the
   canonical gap.
4. For each confirmed gap, file a grounded follow-up via the **webjs-file-issue**
   skill (title `docs: <surface> missing <feature>`, body naming the exact files
   to edit and the source of truth to copy from). Do not fix silently without a
   tracked issue when auditing in bulk; the issue is the unit of work.
5. Then implement the fixes (each its own logical commit, `docs:` prefix for the
   changelog), syncing ALL applicable surfaces per the per-change procedure.

## What this skill does NOT do

- It does not regenerate `llms.txt` / `llms-full.txt` (those are live-generated).
- It does not hand-write the website changelog (auto from PR titles).
- It does not decide whether a change is internal; that judgement is step 1, and
  a genuinely internal change correctly updates no doc surface.
