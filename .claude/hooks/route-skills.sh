#!/usr/bin/env bash
#
# UserPromptSubmit hook: route every prompt to the skills it matches, so a
# relevant skill is never silently skipped.
#
# Why this exists: a Skill is model-invoked. It fires only when the model
# judges the request to match the skill's triggers, and that judgement can
# be wrong. In one session a "can we add prefetch, verify in the remix
# repo, let me know" request was treated as pure research, so the
# webjs-file-issue workflow was skipped and code investigation started with
# no tracked issue. Skill descriptions and AGENTS.md prose are advisory;
# only a hook is deterministic. This hook closes the gap the same way the
# em-dash hook does: it runs on every prompt, decides from the prompt TEXT
# (not from model judgement), and injects a high-priority directive.
#
# What it can and cannot do (verified against the Claude Code hooks
# reference): a hook CANNOT invoke a Skill tool-call itself. The strongest
# deterministic lever is UserPromptSubmit additionalContext, injected as a
# system reminder the model reads before acting. So this hook does two
# things on every webjs prompt:
#
#   1. KEYWORD ROUTING. Match the prompt against each skill's documented
#      triggers. For each hit, name the skill and direct that it be
#      invoked via the Skill tool BEFORE any other work.
#   2. STANDING RULE. Always inject the generic policy: before acting,
#      check the available skills and invoke any whose purpose matches the
#      request, because skills encode required workflow. This catches the
#      case keyword routing misses, where a research or design request
#      turns into tracked work mid-stream.
#
# The rule is generic across ALL skills by design. It is NOT a rule about
# any single skill or about filing GitHub issues specifically; it enforces
# that whatever the matching skill says is followed.
#
# Output contract: print one JSON object with
# hookSpecificOutput.additionalContext and exit 0. The hook never blocks a
# prompt (exit 2 would erase it); routing must inform, not gate, since the
# model still owns the Skill call.

set -euo pipefail

payload=$(cat)

prompt=$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null || true)
if [ -z "$prompt" ]; then
  exit 0
fi

# Case-fold once for matching. Keep the original only for nothing; all
# matches are case-insensitive.
lc=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')

# has PATTERN: extended-regex test against the lowercased prompt.
has() { printf '%s' "$lc" | grep -Eq "$1"; }

# Accumulate the per-skill routing lines that fired.
matches=""
add_match() { matches="${matches}${matches:+$'\n'}- $1"; }

# --- webjs-file-issue: create new tracked work --------------------------
# Triggers per its SKILL.md: file a task, create an issue, track as a todo,
# add to the todo list, open an issue, make this an issue, file a bug, add
# a new task.
if has '(file|open|create|add|make).{0,20}(task|issue|todo|bug)' \
   || has 'track (this|it|that).{0,12}(as|on|in).{0,12}(todo|issue|board)' \
   || has 'add (a )?new (task|todo|item)' \
   || has 'make (this|it) (an? )?issue'; then
  add_match "webjs-file-issue: the request involves creating new tracked work. Invoke the webjs-file-issue skill (it files the GitHub issue, assigns vivek7405, adds it to the board) BEFORE writing code for that work."
fi

# --- webjs-start-work: begin a tracked issue ----------------------------
# Triggers: work on #N, start work on issue N, tackle #N, pick up #N,
# begin issue N, let's work on the X issue.
if has '(work on|start work|pick up|tackle|begin).{0,24}#?[0-9]+' \
   || has '(start|begin|pick up).{0,16}(work|issue|the .* issue)' \
   || has "let'?s (work on|start)"; then
  add_match "webjs-start-work: the request is to begin a tracked issue. Invoke the webjs-start-work skill (it branches off main, moves the card to In progress, sets up the workspace) BEFORE starting the work."
fi

# --- webjs-ready-for-dev: plan a tracked issue into implementable shape --
# Triggers: get #N ready for development, ready these issues for dev, prep
# #N for development, make these todos implementation-ready, write the
# implementation plans for these issues, scope out #N. The deliverable is a
# verified implementation plan written INTO the issue body, not code, so
# this precedes webjs-start-work rather than replacing it. Deliberately
# narrow on the word "ready": "ready to merge" and "ready for review" are
# about a PR and must NOT route here, which is why every pattern requires
# dev / development / implementation adjacency or an explicit plan noun.
if has 'ready.{0,16}for (dev|development|implementation|an implementer)' \
   || has 'ready (these|those|the|them|it|this).{0,24}(for )?(dev|development)' \
   || has 'implementation[- ]ready' \
   || has '(prep|prepare|scope).{0,32}(for (dev|development)|out)?.{0,8}#[0-9]+' \
   || has '(write|create|add|generate).{0,24}implementation plans?' \
   || has 'get .{0,40}(issue|todo|item|#[0-9]+).{0,24}ready'; then
  add_match "webjs-ready-for-dev: the request is to get tracked issues ready for development, meaning a verified implementation plan written INTO each issue body. Invoke the webjs-ready-for-dev skill. It runs ONE autonomous background agent per issue, all spawned in a single message so they run in parallel, each read-only on the repo (no git mutation, since the agents share the working tree), each rewriting its issue body to the cold-start standard and then moving the card to the Ready column. Do a conflict pass over the batch FIRST and queue any issue whose file surface another issue in the batch is about to rewrite. This skill writes no code and opens no PR; implementation is webjs-start-work, later."
fi

# --- webjs-list-todos: what is open / pending ---------------------------
# Triggers: what's open, what's pending, list todos, current todo, what
# should I work on, show open issues, what's in progress, on the board.
if has "what'?s (open|pending|in progress|on the board|next)" \
   || has '(list|show).{0,16}(todo|open issue|pending|board)' \
   || has '(current|open|pending) (todo|issue|work|item)' \
   || has 'what should i work on'; then
  add_match "webjs-list-todos: the request asks what work is open or pending. Invoke the webjs-list-todos skill (it reads the project board, the source of truth) instead of guessing."
fi

# --- use-railway: infra / deploy ----------------------------------------
# Triggers: railway, deploy, redeploy, service(s), environment, bucket,
# object storage, build failure, infrastructure.
if has '(railway|redeploy|deploy(ed|ment)?|provision)' \
   || has '(object storage|bucket|infrastructure)' \
   || has '(build|deploy) (failure|failed|error)'; then
  add_match "use-railway: the request touches deployment or infrastructure. Invoke the use-railway skill for any Railway operation rather than ad-hoc commands."
fi

# --- webjs-research-record: research / design / decision writeup --------
# Triggers: research whether/into X, investigate X and write it up,
# evaluate X vs Y, a design/decision record, write up the design, spike X.
# The deliverable is a writeup with no code diff. It belongs in a CLOSED
# `research`-labeled issue (the same issue if one already exists in the
# backlog), never a file in the reference docs and never a comment on an
# unrelated PR (the #548 mistake this routing prevents).
if has 'research (whether|if|into|on|the|to|question)' \
   || has '(design|decision|research) (record|note|write-?up|history|doc)' \
   || has 'write ?(up|out)? ?(the |a )?(design|decision|research)' \
   || has 'investigate.{0,80}(write|design|approach|record|decision|trade-?off)' \
   || has '(evaluate|compare).{0,40}(vs|versus|against)' \
   || has 'spike (on|the|a|into|[a-z])'; then
  add_match "webjs-research-record: the deliverable is a research/design/decision writeup with no code diff. Invoke the webjs-research-record skill. The record lives in a \`research\`-labeled issue (append to the existing backlog issue if there is one, else create one), writeup in the body + comments, then CLOSE it. NOT a file in the reference docs, NOT a PR, NOT a comment on an unrelated PR. File the follow-up implementation via webjs-file-issue."
fi

# --- webjs-doc-sync: keep all doc surfaces in sync ----------------------
# Triggers: sync the docs, update the docs/website/docs-site, doc gap or
# drift, find missing docs, "did we update the docs", audit shipped work
# for documentation. The skill carries the full surface map (AGENTS.md +
# the skill at .agents/skills/webjs/, README, the docs site, the website,
# the scaffold per-agent rule files) so a feature is never documented in only ONE place (the #488
# gap: HTTP-verb actions landed in AGENTS.md but the docs site stayed
# stale).
if has '(doc|documentation) (gap|drift|sync|coverage|debt)' \
   || has '(sync|update|refresh|fix).{0,24}(the )?(doc|docs|documentation|docs site|website)' \
   || has '(missing|stale|outdated|out-of-date|out of date).{0,20}(doc|docs|documentation)' \
   || has 'did (we|you|i) (update|sync).{0,20}(doc|docs)' \
   || has '(audit|sweep|check).{0,40}(doc|docs|documentation)'; then
  add_match "webjs-doc-sync: the request is about documentation sync, drift, or a doc gap. Invoke the webjs-doc-sync skill BEFORE editing any doc. It holds the authoritative map of EVERY surface (AGENTS.md + the skill at .agents/skills/webjs/, README, the docs site under website/app/docs/, the rest of the marketing website/, and the scaffold templates' per-agent rule files) and the change-type to surface mapping, so no surface is silently skipped. File each confirmed gap via webjs-file-issue."
fi

# --- webjs-scaffold-sync: keep every scaffold surface in sync -----------
# Triggers: change what `webjs create` generates (a gallery/showcase demo, a
# template, the generated layout/home/theme/schema), sync the scaffold,
# "update all three templates", check the scaffold is consistent, teach
# agents via the scaffold. The scaffold is webjs's PRIMARY teaching surface,
# so a change must propagate across the generators (packages/cli/lib/*), the
# scaffold tests, the framework template-matrix docs, and the preview apps,
# with a mandatory "generate + boot + check".
if has '(sync|update|check|fix|add to).{0,24}(the )?(scaffold|template)' \
   || has '(all (three|3) )?(scaffold )?templates?\b' \
   || has 'gallery.{0,40}(template|saas|api|full-?stack|scaffold)' \
   || has '(ship|include|add|put).{0,30}(the )?(gallery|showcase)' \
   || has '(add|new|update).{0,24}(gallery|showcase)' \
   || has '(scaffold|gallery) (consistent|in sync|drift|gap)' \
   || has 'what `?webjs create`? generates' \
   || has '(feature|backend) gallery'; then
  add_match "webjs-scaffold-sync: the request changes what \`webjs create\` generates (a gallery/showcase demo, a template, a generated file, a scaffold convention). Invoke the webjs-scaffold-sync skill BEFORE editing. It holds the authoritative map of every scaffold surface (the packages/cli/lib/* generators, the templates/, the scaffold tests, the framework template-matrix docs, the preview apps) plus the mandatory generate-boot-check verification, so no surface is silently skipped. It is the scaffold-side sibling of webjs-doc-sync."
fi

# --- webjs-blog-write: write a blog post in the author's voice ----------
# Triggers: write/draft a blog post, an SEO blog, blog about a feature,
# "we shipped X but never blogged it". The skill carries the author's voice
# (analyze it by reading all blog/*.md FIRST), the hard prose rules (no
# em-dashes, no internal PR/issue numbers, no process tells), the SEO
# front-matter conventions, the de-duplication check against every existing
# post, and the mandatory dogfood verification of every claim in a feature
# post before it ships.
if has '(write|draft|author|compose).{0,24}(a |an |the )?(seo )?blog' \
   || has 'blog post' \
   || has '(seo|new) blog\b' \
   || has 'blog (about|on|for|covering)' \
   || has '(never|not) blogged'; then
  add_match "webjs-blog-write: the request is to write or substantially edit a blog post. Invoke the webjs-blog-write skill BEFORE writing prose. It requires analyzing the author's voice by reading all blog/*.md first, and carries the hard rules (no em-dashes, no internal #NNN numbers in prose, no process tells), the SEO topic + front-matter conventions, the de-duplication check against every existing post, and the mandatory dogfood verification of every factual claim in a feature post."
fi

# --- webjs-instagram-post: publish an SEO post to Instagram -------------
# Triggers: post to Instagram, publish an Instagram post, share/promote a
# page or feature on Instagram. Every post is SEO-only and MUST ship a
# freshly created branded image plus a keyword-rich caption. The skill
# holds the account id, the credential location (never printed), the image
# recipe, the public-hosting requirement, and the confirm-first publish.
if printf '%s' "$lc" | grep -q 'instagram' \
   && has '(post|publish|share|promote|upload|announce|put up|schedule)'; then
  add_match "webjs-instagram-post: the request is to publish to the WebJs Instagram account. Invoke the webjs-instagram-post skill. Every post is SEO-only, so ALWAYS create a fresh branded image plus a keyword-rich caption, host the JPEG at a public HTTPS URL, and CONFIRM the image and caption with the user before the public publish. Never print or commit the access token."
fi

# --- code-review: review the diff before a PR is ready ------------------
# Triggers: review the PR/diff/branch/changes, code review, look it over
# for bugs. Reviewing every change before it is marked ready is a standing
# expectation, and a review is the CYCLE the webjs-start-work skill
# defines: one reviewer over the whole diff, a minor-or-must-fix call, and
# at most one delta round on the fixes, escalating to delta rounds plus a
# final whole-diff review only when the change shows it needs them. This
# directive and the skill must not resolve a case differently, which they
# once did for the final fix-check; test/hooks/review-loop-exit.test.mjs
# asserts the shared wording of the rules that decide when the cycle ends.
# code-review is a built-in Claude Code skill (no in-repo SKILL.md, so the
# portability test that guards project skills does not cover it).
if has '(review|audit) (the |my |this )?(pr|diff|branch|change|changes|code|commit)' \
   || has 'code ?review' \
   || has '(review|look) .{0,20}(over )?for (bug|issue|correctness|regression)'; then
  add_match "code-review: the request is to review code. Invoke the code-review skill (it reviews the diff for correctness bugs plus reuse and simplification). A review of a PR runs the webjs-start-work review cycle, which is ONE fresh reviewer over the whole diff, never a fleet, and which defaults to its FAST shape because every round costs about 10 minutes and the owner should not have to ask for a short cycle. Fast shape: round 1 reads the whole diff; only a MUST-FIX fix buys a round and it buys exactly ONE, delta-scoped to those fix commits alone; a round whose fixes were all minor ends the cycle instead; then stop. A clean or minor-only round 1 therefore finishes with ONE review, which is the intended common case. Speed comes from running fewer rounds, never from lowering the bar inside a round. Escalate to the THOROUGH shape when the owner asks for a thorough or full review, or round 1 produced two or more must-fix findings or the one delta round produced any, or the diff touches the serializer, SSR or action dispatch, auth or session, the client router, or the elision analyser. Thorough shape: each later round is delta-scoped to the previous round's fix commits, and the first round that produces no fixes, whether it found nothing must-fix or everything it found was rejected or deferred, buys a FINAL review over the whole diff again. The code-review skill's findings feed that cycle as auxiliary input, not as a round of it. Every reviewer is spawned with the Agent tool as subagent_type general-purpose, model opus (Opus 5, never fable), run_in_background true, and isolation worktree. Judge each finding MINOR or MUST-FIX by SURFACE, never by importance: must-fix when it touches source, a test's ability to observe the defect it claims to cover, or a factual claim about runtime behavior in docs; minor for wording, naming, comment style, and nits about the review artifacts; when it could go either way it is must-fix. Only a FIX buys another round, since only a fix changed the branch, and a delta chain that keeps producing fixes stops after the fifth delta round, unfinished, rather than continuing; a rejection buys one refuter instead, and a deferral and a minor finding buy nothing. After the final review, a must-fix finding is fixed and gets ONE delta check of that fix alone; the cycle ends when nothing must-fix is left open, meaning the check came back with nothing or there was no fix to check because every must-fix finding the final review raised was rejected or deferred; a check that does find something must-fix gets that fixed and one more check of the same shape, and only if that one also finds something must-fix do you stop and report the PR unfinished. Do not file follow-up issues for review findings that are out of scope; report them to the owner, who decides, and fold a small same-file tweak into the PR. Never report the PR ready off a round that found something must-fix."
fi

# --- verify: prove the change works by running the app ------------------
# Triggers: verify/confirm the fix works, does it work, manually test it,
# boot or dogfood the apps. The standing rule is to boot the two dogfood
# apps (blog e2e plus website) on every framework PR. verify is a built-in
# Claude Code skill (no in-repo SKILL.md).
if has 'verify (the |this |that |it )?(change|fix|feature|pr|work|it works|behaviou?r)' \
   || has '(confirm|prove|make sure) .{0,30}(works|working|fixed|fixes it)' \
   || has '(manually|actually) (test|try|check) .{0,20}(it|the (fix|change|app|feature))' \
   || has '(boot|dogfood|smoke).{0,20}(app|apps|blog|website|docs)'; then
  add_match "verify: the request is to confirm a change actually works. Invoke the verify skill (run the app and observe the behaviour). For a change to a shared runtime surface (core/server SSR, client router, importmap, dist, elision), boot the AFFECTED dogfood apps and report evidence. CI covers both in-repo apps (blog and website). A docs-only, test-only, or tooling change needs no app boot."
fi

# Assemble the additional context. The standing rule is always present; the
# per-skill routing block appears only when something matched.
read -r -d '' standing <<'EOF' || true
webjs skill policy (enforced, read before acting):
Before doing the work in this prompt, check the available skills. If the
request matches ANY skill's purpose, you MUST invoke that skill via the
Skill tool BEFORE other work. Skills encode required project workflow;
skipping a matching skill is a policy violation, not a shortcut. This holds
even when the prompt reads as research, a question, or a design ask but the
work it leads to is something a skill governs (for example, investigation
that turns into new tracked work must still go through the issue-filing
skill before code is written). Treat the routing below as authoritative for
THIS prompt.
EOF

if [ -n "$matches" ]; then
  ctx="${standing}"$'\n\n'"Skills matched by this prompt:"$'\n'"${matches}"
else
  ctx="${standing}"$'\n\n'"No skill triggers matched by keyword. Still apply the policy above: if you determine mid-task that the work matches a skill, invoke it before proceeding."
fi

jq -n --arg ctx "$ctx" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
exit 0
