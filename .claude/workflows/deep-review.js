export const meta = {
  name: 'deep-review',
  description: 'Deep multi-agent PR review: parallel finder lenses, then adversarial verification, reporting only confirmed findings',
  whenToUse: 'High-risk PRs where a single review pass is not enough. Works on any repo. Pass the PR number as args, or { pr, repo } to target another repository.',
  phases: [
    { title: 'Find', detail: 'six lenses over the PR in parallel, one on a different model' },
    { title: 'Verify', detail: 'adversarial refuters per finding, majority rules' },
  ],
}

// args: a PR number ("123" or 123), an "owner/repo#123" string, or { pr, repo }.
// When no repo is given, every agent detects it from its own cwd via gh.
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
if (!pr) throw new Error('Pass the PR number as args, e.g. Workflow({ name: "deep-review", args: "123" }), or "owner/repo#123", or { pr, repo }')

const REPO_FLAG = repo ? ` --repo ${repo}` : ''
const REPO_NOTE = repo
  ? `The repository is ${repo}; pass --repo ${repo} to every gh call.`
  : 'Detect the repository once with `gh repo view --json nameWithOwner -q .nameWithOwner` from your working directory and use it for every gh call.'

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
- Any file at head: gh api "repos/<owner>/<repo>/contents/<path>?ref=<headRefName>" --jq .content | base64 -d
Do NOT fetch PR comments or prior reviews. If the repo carries contributor rules (AGENTS.md, CONTRIBUTING.md, CONVENTIONS.md, or similar at the root or per-package), read the relevant ones and judge against them.`

const LENSES = [
  { key: 'correctness', prompt: 'Correctness of the change itself: logic errors, inverted conditions, off-by-ones, broken control flow, wrong API usage, error paths that swallow or misreport. Trace each changed function end to end.' },
  { key: 'security', prompt: 'Security: injection, authz/authn gaps, CSRF surface changes, secrets or server-only code reaching the client, open redirects, unsafe deserialization, trust-boundary violations. Weight anything on an authentication, serialization, or request-dispatch path most heavily.' },
  { key: 'blast-radius', prompt: 'Ripple effects: for every symbol, export, config key, or rule the diff touches, grep the WHOLE repo at head for its other users and check each still holds. A small change that breaks a distant caller is your only quarry.' },
  { key: 'tests', prompt: 'Test adequacy: would the PR\'s tests FAIL if each functional change were reverted (counterfactual)? Name any changed behavior with no failing-test proof, any test asserting the mock rather than the behavior, and any test layer the repo\'s contributor rules demand that this change touches but does not cover.' },
  { key: 'invariants-docs', prompt: 'Invariants and doc drift: check the diff against every invariant and convention the repo\'s contributor rules state, and check every doc surface that describes the changed behavior still tells the truth at head.' },
  { key: 'fresh-eyes', prompt: 'Broad second-opinion pass: read the diff cold and report anything genuinely wrong, with no assigned angle. Prefer depth on the riskiest hunk over breadth.', model: 'fable' },
]

phase('Find')
log(`deep-review of PR ${pr}${repo ? ` in ${repo}` : ''}: ${LENSES.length} lenses in parallel`)

const found = await parallel(LENSES.map((l) => () =>
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

if (toVerify.length === 0) return { pr, repo, confirmed: [], rejected: [], raw: all.length, note: 'no findings survived dedup; treat as a clean deep pass' }

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
  stats: { raw: all.length, deduped: deduped.length, verified: toVerify.length, lenses: LENSES.length },
  note: 'Confirmed findings feed the normal review loop: fix, post as one review object, then a delta round. Rejected ones carry their refuters\' reasons for the audit trail.',
}
