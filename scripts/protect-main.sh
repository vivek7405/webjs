#!/usr/bin/env bash
# Require an approving review + all CI checks before a PR can merge into main.
#
# This is the enforcement half of .github/workflows/ci.yml: the workflow
# RUNS the tests, this rule BLOCKS merge until every required check is green
# AND the PR has at least one approving review. Run once (needs repo admin).
# Re-running is idempotent.
#
# NOTE on the review requirement: GitHub does not let a PR author approve
# their own PR, and this repo is effectively a solo org. enforce_admins is
# left false so the org owner can still merge via the admin bypass (a
# confirm step), which keeps the approval as a visible speed-bump without
# locking solo PRs. Flip enforce_admins to true only once a second reviewer
# (a human or a bot account) exists to provide the non-author approval.
#
# NOTE on require_code_owner_reviews: it is paired with .github/CODEOWNERS,
# which names @vivek7405 for every path. Without that file the setting matches
# nothing and silently does nothing, so the two ship together. With both in
# place, the one required approval must come from the maintainer, which is
# what stops two drive-by contributors from approving each other onto main.
#
#   bash scripts/protect-main.sh
#
# The contexts below must match the `name:` of each job in ci.yml exactly,
# because GitHub keys required status checks on the job display name.

set -euo pipefail

REPO="webjsdev/webjs"

gh api -X PUT "repos/${REPO}/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Conventions (webjs check)",
      "Unit + integration (node --test)",
      "Browser (web-test-runner / Playwright)",
      "E2E (Puppeteer against the blog example)",
      "Build (@webjsdev/core dist)",
      "In-repo app tests (website + blog)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": true
  },
  "restrictions": null
}
JSON

echo "main is now protected: 1 approving CODEOWNER review + all CI checks required before merge."
