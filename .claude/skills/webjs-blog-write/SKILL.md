---
name: webjs-blog-write
description: Use this skill whenever the task is to write, draft, or substantially edit a webjs blog post (a marketing/engineering post under the repo-root `blog/` directory that the website publishes). It carries the author's voice, the hard prose rules (no em-dashes, no internal PR/issue numbers, no process tells), the SEO-first topic and front-matter conventions, the de-duplication check against every existing post, and the mandatory dogfood verification of every factual claim before a feature post ships. Invoke it BEFORE writing any blog prose so the post lands in the house voice and does not need a later cleanup pass.
when_to_use: |
  Examples that should trigger this skill:
    "write a blog post about the new streaming actions feature"
    "draft an SEO blog for the path-alias imports"
    "we shipped X but never blogged it, can you write one"
    "add a blog post explaining CSRF without tokens"
    "find blog topics from the changelog and write them"
    editing an existing blog post's prose in a non-trivial way
  Do NOT trigger for: filing an issue (webjs-file-issue), syncing framework
  API docs or the docs site (webjs-doc-sync), or the docs site's own
  `website/app/docs/**` pages (those are reference docs, not blog posts).
---

# Write a webjs blog post

The repo publishes engineering blog posts from the repo-root `blog/` directory. The website reads them directly (`website/modules/blog/queries/list-posts.server.ts`, `BLOG_DIR = <repo>/blog`), parses the front matter, and sorts by `date` descending. A post is one markdown file at `blog/<slug>.md`. This skill is how a new post lands in the author's voice, ranks for search, and states only claims that are actually true, without a later cleanup pass.

## Step 0 (mandatory, do this FIRST): analyze the author's current style

Do NOT write from a fixed style spec. The voice is defined by the corpus, and the corpus changes over time, so a hard-coded spec goes stale. Before writing a single sentence:

1. Read a broad sample of `blog/*.md` (at least six to eight posts spanning different topics and dates, including the two or three most recent by `date`). Read whole posts, not just the openings.
2. From that reading, note for yourself: how the author opens a post, how paragraphs are paced, how code is introduced, how sections are titled, how a post closes, and which words and rhythms recur. The sections below capture what has been true so far, but the corpus you just read is the authority. If it has drifted from this description, follow the corpus and update this skill.

The patterns that have held so far (confirm them against what you read):

- **First person, opinionated, honest.** The author writes as themselves ("I wanted the opposite", "kept biting me", "I did not find one I enjoyed using"). Personal origin and motivation are welcome.
- **A concrete hook, never a definition.** Posts open on a scenario, an attack, a painful task, or a plain-language framing, not on "X is a...". A handful of posts use a signature "Let me start with..." or "Let me show you" opener; keep that phrasing where the author reaches for it, but the dependable pattern is the concrete hook itself, not the specific words.
- **Beginner-friendly.** Every acronym or jargon term is expanded in parentheses on first use, for example "SSR (server-side rendering)" or "an async generator (a function that yields values over time instead of returning once)".
- **Second person in walkthroughs.** Once into the mechanics, the author addresses "you" and shows real `ts` / `sh` code blocks.
- **The painful old way, then the WebJs way.** Most feature posts show the tedious status-quo pattern first (a useEffect + spinner, thirty lines of optimistic bookkeeping, a native-addon compile), then the WebJs version that removes it.
- **Section headers are single `#`, sentence case, often with a trailing clause.** For example "# The classic answer, and why it is fiddly" or "# What the sourcemap layer cost".
- **Length runs substantial, commonly around 1000 to 1600 words, with deeper posts closer to 2200.** Match the length of comparable posts you read in Step 0. Substance over padding, and never pad to hit a number.
- **Vary the closing.** Do NOT reach for a generic "# The takeaway" header. A closing header that repeats verbatim across the blog is the clearest formulaic tell there is, no matter how good each post is on its own. Most posts should just land their point in the final paragraph with no labeled closing section at all. When a post does want a labeled close, give it a header specific to that post's argument, and check that no other post already uses it. Treat any header that shows up on more than one or two posts as a smell.
- **Contrast with the tool the reader knows.** React, Next.js, Rails, Lit, Remix, Astro. Explain what that tool does and why WebJs chose differently, on WebJs's own terms.

## Front matter (copy this exact shape)

```
---
title: "<SEO title in Title Case>"
date: <ISO 8601 with the +05:30 offset, e.g. 2026-07-10T10:00:00+05:30>
slug: <kebab-case, matches the filename without .md>
description: "<one to three sentences, SEO-rich, names WebJs and the key search terms a reader would type>"
tags: <comma-separated, lower-case>
author: Vivek
---
```

- `title` and `description` are the SEO surface. Write the `description` for a human scanning a search result: what the post teaches, in the words they would search, mentioning WebJs.
- `slug` must equal the filename. The site keys the URL on it.
- `date` slots the post into the timeline (the index sorts by it, descending). Pick a date that reads sensibly next to the neighbouring posts. You may adjust the dates of a batch of new posts so the cadence looks even, but do not future-date beyond today.

## Hard rules (a commit hook enforces the punctuation ones; the rest are voice)

1. **No em-dashes (U+2014). No hyphen or semicolon used as pause punctuation between words** (no space-hyphen-space, no space-semicolon-space), and **no colon after a code-shaped left-hand side** (rephrase verb-led). This is AGENTS.md invariant 11. `.claude/hooks/block-prose-punctuation.sh` scans new content and BLOCKS a violating commit. Use a period, a comma, parentheses, or a restructure. Plain hyphens in compound words, flags, and filenames are fine.
2. **No internal PR or issue numbers in prose.** A blog reader has no context for `#605` or `#849`. Never write "(#NNN)", "landed in #NNN", "issue #NNN", or "shipped in #NNN and #NNN". State the capability and its behaviour; the tracking number belongs in git and on the issue, not in published copy. (This is exactly what had to be cleaned out of the whole blog set once already.)
3. **No process, reasoning, or AI tells.** Nothing about how the post or the feature was verified ("Verified by dogfooding"), no "self-review", no "as I mentioned earlier", no meta-narration of the writing. The reader wants the capability, not your workflow.
4. **Do not undermine webjs.** Cut self-deprecating maturity lines ("new", "early", "no users at scale yet"). Express honesty as the competitor's genuine strength, not as a WebJs deficiency.
5. **Sell the capability on its own terms.** Do not pitch a WebJs feature as "another tool's branded feature, but native" (no "Turbo Frames, but for WebJs"). Name what it does and why it is good in plain terms.
6. **Defaults, not lock-in.** Drizzle, Tailwind, and SQLite are scaffold DEFAULTS. Never frame WebJs as coupled to them; it is bring-your-own-flexible.

## Sound like the author, not like a model

The single most important quality bar for a webjs post is that it reads as though the author, Vivek, sat down and wrote it himself, not as though a model generated it. The posts publish under his byline, so the target is not generic "human writing" but his specific voice, which the corpus you read in Step 0 is the reference for. A post that reads as AI-generated, or as written by someone other than the author, fails no matter how correct it is.

Cut the tells that make writing read as machine-generated:

- **Hype and empty superlatives.** "powerful", "seamless", "robust", "effortless", "game-changer", "elegant", "blazing fast", "unlock", "leverage", "delve", "dive in", "supercharge". Delete them or replace each with a specific, verifiable claim.
- **Signposting and filler.** "In this post we will explore", "Let's take a look", "It is worth noting that", "Here's the thing", "Now, you might be wondering", "At the end of the day", "In conclusion", "To sum up". Just make the point.
- **Symmetric, list-shaped structure.** Every section the same length, every paragraph exactly three sentences, a rule-of-three in every sentence ("fast, simple, and reliable"), a bulleted list where prose would read better. Vary the shape.
- **Hedged neutrality.** An even "on one side, on the other side" with no actual position. The author takes a side and says why.
- **Restating the heading** in the first sentence of its section, and over-explaining what the reader already understood.
- **Generic placeholder examples** (foo, bar, widget, `doSomething()`). Use a real, specific example a reader could actually build.
- **Em-dashes and the other invariant-11 punctuation.** Already banned above, and a classic generated-text tell, so this rule pulls double duty.
- **The same skeleton on every post.** This is the one that shows up only when you look at the blog as a whole. If every post opens the same way, runs the same section shape, and closes with the same header, the blog reads as a template even when each post is fine on its own. The patterns in this skill (the old-way-then-WebJs contrast, the concrete hook) are options to reach for, not a frame to stamp on every post. Let each topic pick the structure it wants: one post is a narrative, another a teardown, another a head-to-head comparison, another a single idea followed all the way down. Vary the openings, the number and naming of sections, and the endings from post to post. Before you settle a section header, scan the other posts (`grep '^# ' blog/*.md | sort | uniq -c | sort -rn`) and do not reuse one that already recurs.

Aim for what makes the corpus read human:

- **A real stake and a real opinion.** Say what you wanted, what annoyed you, what you tried and dropped, why you chose one thing over another. Keep the first-person point of view.
- **Specific, concrete detail from real experience.** The exact thing that bit you, a real number you measured, a real file path, the actual failure mode. Specificity is the strongest human signal there is.
- **Varied rhythm.** Mix a long explanatory sentence with a short blunt one. Not every paragraph is the same shape or length.
- **Plain, direct language** over median-of-the-internet phrasing. "it runs", not "it seamlessly executes".

The test before you ship: read the draft aloud and ask whether the author would actually say this sentence to another engineer over coffee. If it reads like a press release or a tutorial template, rewrite it. Then compare its rhythm and word choice against two real posts from Step 0. If it does not sound like the same person wrote all three, it is not done.

## Process: from topic to a published, true post

1. **Pick an SEO topic backed by shipped work.** Mine the git history, the merged PRs, the per-package changelog, and the closed issues for a real, shipped capability that a developer would search for and that no existing post already covers. High-intent angles (migration from another framework, a concrete how-to) rank best.
2. **De-duplicate against EVERY existing post, directly AND indirectly.** Delegate the sweep to one read-only `Explore` agent over `blog/*.md` returning per-post topic-and-angle summaries (the corpus is small, so the win is keeping your context clean rather than parallelism), then judge overlap yourself against its return. A new post must not restate a published one, even partially. If two candidate topics overlap, either merge them or sharpen each to a distinct angle and cross-link rather than repeat. Two posts that share a mechanism should each own a different facet and reference the other, not re-explain it.
3. **For a feature post, verify every factual claim by dogfooding before you publish.** This is not optional for a post that describes runtime behaviour. Scaffold a real app (`webjs create`) and run the verification's independent parts as ONE batch of background Bash tasks: the Node boot and the Bun boot in parallel (BOTH stay mandatory where a claim is runtime-sensitive, one never satisfies the other), with the per-claim `curl` probes against whichever boot they need, and EVERY task's result collected before the post is called verified, since a forgotten background probe is an unverified claim shipping. Browser-dependent probes (hydration, streaming, client-router, a11y) stay in the main session, where the browser tooling lives. Confirm each claim with a real probe: `curl` for HTTP and header behaviour, a browser for hydration, streaming, client-router, and a11y. If a claim turns out false, FIX the post to state the truth, and file a framework issue via `webjs-file-issue` if the framework itself is wrong. A blog post that states a behaviour the framework does not have is the failure this step exists to prevent. Do not report a post done off unverified claims.
4. **Write the post** in the voice from Step 0, obeying the hard rules.
5. **Place the file** at repo-root `blog/<slug>.md`. Do not put it under `website/`. Confirm the front matter has `title` and `date` (the index drops files missing either).
6. **Self-check before committing.** Grep your own draft: `grep -nE '#[0-9]{3,4}' blog/<slug>.md` must return nothing, and scan for process tells ("dogfood", "self-review", "verified by"). Confirm no em-dash or banned pause punctuation. Read the whole post once as a reader who has never seen the codebase.

## Related skills

- **webjs-file-issue**: file the tracking issue for the blog work before writing, and file a framework issue if dogfooding surfaces a real bug.
- **webjs-doc-sync**: for the framework's own reference docs (`AGENTS.md`, the skill at `.agents/skills/webjs/`, the docs site under `website/app/docs/`). A blog post is not a doc-sync surface, and reference docs are not a blog. Keep them separate.
- **webjs-list-todos**: to see what shipped work is open or recently done when hunting for a topic.
