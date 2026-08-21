## Summary

<!-- What does this PR do? 1-3 bullet points. -->

## Test plan

- [ ] Unit tests added/updated (`webjs test` passes)
- [ ] E2E tests added/updated for user-facing changes (`webjs test --e2e` passes)
- [ ] `webjs check` passes (no convention violations)
- [ ] `webjs doctor` passes (project health; it fails on whatever `webjs.doctor.gate` marks `error`, plus the hard `NODE_VERSION` / `TSCONFIG_ERASABLE` checks)

## Definition of done

Documentation MUST land on the same PR as the code change. Drift is how
a codebase rots. Walk every markdown file in the project (`git ls-files
'*.md'`) and ask whether this PR changed behaviour, surface, or
invariants it describes. For each row below, write `Updated <path>` or
`N/A because <reason>`. Reviewers should reject the PR if this section
is left as the template default. The workflow rules are in
[`.agents/rules/workflow.md`](../.agents/rules/workflow.md).

- [ ] **Tests.** Unit coverage for logic. Real-browser coverage for
      user-facing behaviour.
- [ ] **Every markdown file in the project** that describes the
      changed surface. Common cases (non-exhaustive): `AGENTS.md` (root
      + nested), `README.md` (root + nested),
      `CHANGELOG.md`, `docs/**/*.md`, `.agents/skills/webjs/**/*.md`,
      `.github/*.md`. The rule is generative: if a markdown file in
      this project mentions a thing this PR changed, it gets touched
      on this PR.
- [ ] **`website/`** (if the project has one). Marketing copy on the
      landing or pricing page when the change touches a claim made
      there.
- [ ] **Scaffold scripts / codegen** (if the project has any). Updated
      when the change affects what new instances generate.
