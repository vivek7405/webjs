export const meta = {
  name: 'deep-review',
  description: 'Deep multi-agent PR review: parallel finder lenses, then adversarial verification, reporting only confirmed findings',
  whenToUse: 'The round-1 review for any PR entering a review loop, or a heavyweight pass on demand. Works on any repo. Pass the PR number as args, "owner/repo#123" for another repository, or { pr, repo, lenses } where explicit lenses skip the scout.',
  phases: [
    { title: 'Scope', detail: 'a scout reads the diff and proposes dynamic lenses for this PR' },
    { title: 'Find', detail: 'six fixed lenses plus up to six dynamic ones, in parallel, split across opus and fable' },
    { title: 'Verify', detail: 'adversarial refuters per finding, majority rules' },
  ],
}

// args: a PR number ("123" or 123), an "owner/repo#123" string, or { pr, repo, lenses }.
// When no repo is given, every agent detects it from its own cwd via gh.
// lenses: optional [{ key, prompt }] of extra lenses; when given, the scout is
// skipped and these run as the dynamic set instead.
let pr = null
let repo = null
if (typeof args === 'number') pr = String(args)
else if (typeof args === 'string' && args.trim()) {
  const s = args.trim()
  if (s.includes('#')) { const [r, n] = s.split('#'); repo = r.trim(); pr = n.trim() }
  else pr = s
} else if (args && typeof args === 'object' && args.pr) {
  pr = String(args.pr)
  repo = args.repo ? String(args.repo) : null
}
const givenLenses = (args && typeof args === 'object' && Array.isArray(args.lenses)) ? args.lenses : null
if (!pr) throw new Error('Pass the PR number as args, e.g. Workflow({ name: "deep-review", args: "123" }), or "owner/repo#123", or { pr, repo }')

const REPO_FLAG = repo ? ` --repo ${repo}` : ''
const REPO_NOTE = repo
  ? `The repository is ${repo}. Pass --repo ${repo} to gh pr commands; gh api has no --repo flag, so there the repo rides in the URL path (repos/${repo}/...).`
  : 'Detect the repository once with `gh repo view --json nameWithOwner -q .nameWithOwner` from your working directory; pass it as --repo to gh pr commands and put it in the URL path of gh api calls (gh api has no --repo flag).'
const REPO_PATH = repo || '<owner>/<repo>'

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'title', 'detail', 'severity'],
        properties: {
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'number', description: '1-indexed line at the PR head' },
          title: { type: 'string', description: 'one-sentence statement of the defect' },
          detail: { type: 'string', description: 'concrete failure scenario: inputs/state leading to wrong behavior' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string', description: 'one or two sentences: why the finding is wrong, or why it survives' },
  },
}

// Shared preamble for every agent. Git worktrees of one repo share a single
// .git directory, so a git write from any agent can reach the primary checkout.
const SAFETY = `HARD CONSTRAINT: you may be running against a repository another session is actively using, and git worktrees share ONE .git directory. You are READ-ONLY on git: never run checkout, switch, reset, restore, stash, pull, ref-moving fetch, merge, rebase, clean, branch -f, or worktree. Read-only inspection only (log, show, diff without changing state, status, blame).

${REPO_NOTE}

Fetch your evidence from GitHub so it works regardless of the local checkout:
- Diff: gh pr diff ${pr}${REPO_FLAG}
- Claims: gh pr view ${pr}${REPO_FLAG} --json title,body
- Head branch name: gh pr view ${pr}${REPO_FLAG} --json headRefName
- Any file at head: gh api "repos/${REPO_PATH}/contents/<path>?ref=<headRefName>" --jq .content | base64 -d
Do NOT fetch PR comments or prior reviews. If the repo carries contributor rules (AGENTS.md, CONTRIBUTING.md, CONVENTIONS.md, or similar at the root or per-package), read the relevant ones and judge against them.`

const LENSES = [
  { key: 'correctness', prompt: 'Correctness of the change itself: logic errors, inverted conditions, off-by-ones, broken control flow, wrong API usage, error paths that swallow or misreport. Trace each changed function end to end.', model: 'opus' },
  { key: 'security', prompt: 'Security: injection, authz/authn gaps, CSRF surface changes, secrets or server-only code reaching the client, open redirects, unsafe deserialization, trust-boundary violations. Weight anything on an authentication, serialization, or request-dispatch path most heavily.', model: 'fable' },
  { key: 'blast-radius', prompt: 'Ripple effects: for every symbol, export, config key, or rule the diff touches, grep the WHOLE repo at head for its other users and check each still holds. A small change that breaks a distant caller is your only quarry.', model: 'opus' },
  { key: 'tests', prompt: 'Test adequacy: would the PR\'s tests FAIL if each functional change were reverted (counterfactual)? Name any changed behavior with no failing-test proof, any test asserting the mock rather than the behavior, and any test layer the repo\'s contributor rules demand that this change touches but does not cover.', model: 'opus' },
  { key: 'invariants-docs', prompt: 'Invariants and doc drift: check the diff against every invariant and convention the repo\'s contributor rules state, and check every doc surface that describes the changed behavior still tells the truth at head.', model: 'fable' },
  { key: 'fresh-eyes', prompt: 'Broad second-opinion pass: read the diff cold and report anything genuinely wrong, with no assigned angle. Prefer depth on the riskiest hunk over breadth.', model: 'fable' },
]
// Every fixed lens pins its model: half opus, half fable. Two model families
// reading the same diff have different blind spots, and pinning makes the
// split deterministic instead of inheriting whatever the session runs.
// Dynamic lenses alternate between the two families by index.

const LENS_PROPOSALS = {
  type: 'object',
  required: ['lenses'],
  properties: {
    lenses: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        required: ['key', 'prompt'],
        properties: {
          key: { type: 'string', description: 'short kebab-case name for the lens' },
          prompt: { type: 'string', description: 'one-paragraph reviewer charter: what this lens hunts and why THIS PR earns it' },
        },
      },
    },
  },
}

phase('Scope')
let dynamic = []
if (givenLenses) {
  dynamic = givenLenses.slice(0, 6).map((l) => ({ key: String(l.key), prompt: String(l.prompt) }))
  log(`using ${dynamic.length} caller-provided dynamic lenses, scout skipped`)
} else {
  const scout = await agent(
    `${SAFETY}

You are the SCOUT for a deep review of PR ${pr}. Read the diff and the PR body, understand what kind of work this PR actually does, and propose ZERO to six ADDITIONAL review lenses tailored to it. Six fixed lenses already run regardless, so never duplicate their ground: correctness of the changed logic, security, repo-wide ripple effects of touched symbols, test adequacy and counterfactuals, invariant and doc drift, and a broad fresh-eyes pass.

Propose a lens only when THIS PR's nature earns it. Examples of the kind of thing that earns one: concurrency or race conditions if the diff touches async coordination; serialization compatibility if a wire format changed; migration or data-loss paths if storage schemas moved; API backward compatibility if public signatures changed; performance if a hot path was rewritten; accessibility if UI semantics changed; prompt-injection surfaces if agent-facing prose or tooling changed. Zero is a fine answer for a PR whose nature the fixed six already cover.

Each proposal is a key plus a one-paragraph reviewer charter written like an order: what to hunt, where in this diff, and what evidence would confirm it.`,
    { label: 'scout:lenses', phase: 'Scope', schema: LENS_PROPOSALS },
  )
  dynamic = ((scout && scout.lenses) || []).slice(0, 6)
  log(`scout proposed ${dynamic.length} dynamic lens(es)${dynamic.length ? ': ' + dynamic.map((l) => l.key).join(', ') : ''}`)
}
const DYNAMIC = dynamic.map((l, i) => ({ key: `dyn-${l.key}`, prompt: l.prompt, model: i % 2 === 0 ? 'fable' : 'opus' }))
const ALL_LENSES = [...LENSES, ...DYNAMIC]

phase('Find')
log(`deep-review of PR ${pr}${repo ? ` in ${repo}` : ''}: ${ALL_LENSES.length} lenses in parallel (${LENSES.length} fixed, ${DYNAMIC.length} dynamic)`)

const found = await parallel(ALL_LENSES.map((l) => () =>
  agent(
    `${SAFETY}\n\nYou are ONE review lens over PR ${pr}. Your single charter:\n${l.prompt}\n\nReport only genuine problems with concrete failure scenarios. No style nits, no suggestions, no padding. Return an empty findings array if you find nothing real.`,
    { label: `find:${l.key}`, phase: 'Find', schema: FINDINGS, ...(l.model ? { model: l.model } : {}) },
  )))

// Barrier is deliberate: dedup needs every finder's output before the
// expensive verification stage spends refuters on duplicates.
const all = found.filter(Boolean).flatMap((r) => r.findings)
const byKey = new Map()
const rank = { critical: 0, major: 1, minor: 2 }
for (const f of all) {
  const key = `${f.file}:${f.line}`
  const prev = byKey.get(key)
  if (!prev || rank[f.severity] < rank[prev.severity]) byKey.set(key, f)
}
const deduped = [...byKey.values()].sort((a, b) => rank[a.severity] - rank[b.severity])
const CAP = 12
const toVerify = deduped.slice(0, CAP)
if (deduped.length > CAP) log(`capping verification at ${CAP} of ${deduped.length} deduped findings (dropped ${deduped.length - CAP} lowest-severity; re-run after fixes to catch them)`)
log(`${all.length} raw findings, ${deduped.length} after dedup, verifying ${toVerify.length}`)

if (toVerify.length === 0) return { pr, repo, confirmed: [], rejected: [], stats: { raw: all.length, deduped: deduped.length, verified: 0, lenses: ALL_LENSES.length, dynamic: DYNAMIC.map((l) => l.key) }, note: 'no findings survived dedup; treat as a clean deep pass' }

phase('Verify')
// Adaptive adversarial jury: 3 refuters for critical, 2 for major, 1 for minor.
// A finding dies when a strict MAJORITY of its jury refutes it, so a 1-1 split
// on a major finding survives (fail-open toward treating it as real).
const juries = { critical: 3, major: 2, minor: 1 }

const verified = await parallel(toVerify.map((f) => () =>
  parallel(Array.from({ length: juries[f.severity] }, (_, i) => () =>
    agent(
      `${SAFETY}\n\nYou are an adversarial verifier. A reviewer claims this defect in PR ${pr}:\n\nFILE: ${f.file}:${f.line}\nCLAIM: ${f.title}\nSCENARIO: ${f.detail}\n\nTry to REFUTE it. Read the actual code at head, trace the scenario, and decide whether the defect is real. Angle ${i + 1}: ${i === 0 ? 'does the claimed scenario actually reproduce in the code as written?' : i === 1 ? 'is the behavior actually correct or intended, making the claim a false positive?' : 'is this already guarded, tested, or handled somewhere the finder did not look?'} If you cannot confirm the defect is real, refuted=true.`,
      { label: `refute:${f.file.split('/').pop()}:${f.line}`, phase: 'Verify', schema: VERDICT },
    )))
    .then((votes) => {
      const cast = votes.filter(Boolean)
      const refutes = cast.filter((v) => v.refuted).length
      // An empty jury (every refuter died) leaves the finding CONFIRMED:
      // fail-open toward the finding being real, never silently dropped.
      const dead = cast.length > 0 && refutes * 2 > cast.length
      return { ...f, confirmed: !dead, jury: cast.length, refutes, reasons: cast.map((v) => v.reason) }
    })))

const results = verified.filter(Boolean)
const confirmed = results.filter((r) => r.confirmed)
const rejected = results.filter((r) => !r.confirmed)
log(`confirmed ${confirmed.length}, refuted ${rejected.length}`)

return {
  pr,
  repo,
  confirmed,
  rejected,
  stats: { raw: all.length, deduped: deduped.length, verified: toVerify.length, lenses: ALL_LENSES.length, dynamic: DYNAMIC.map((l) => l.key) },
  note: 'Confirmed findings feed the normal review loop: fix, post as one review object, then a delta round. Rejected ones carry their refuters\' reasons for the audit trail.',
}
