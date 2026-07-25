# AGENTS.md for docs.webjs.dev (redirect-only)

**The documentation itself no longer lives here.** It is served by the
marketing site at `webjs.dev/docs`, from `website/app/docs/**`. To add or
edit a doc page, go to [`../website/AGENTS.md`](../website/AGENTS.md).

This directory is now a tiny redirect-only service, and it exists for one
reason: **`docs.webjs.dev` must keep resolving forever.** Framework error
messages in ALREADY-PUBLISHED npm packages point at that host, and a
published version can never be retroactively corrected, so old installs will
keep sending people here for as long as they run. Do not delete this service
and do not repoint its domain at something that 404s.

## What it does

`middleware.ts` answers every request with a path-preserving permanent
redirect to the same path on `webjs.dev`, so `docs.webjs.dev/docs/routing`
lands on `webjs.dev/docs/routing` rather than dumping the visitor on a hub
page. A bare `/` goes to `/docs` (someone visiting this host wants the
documentation, not the marketing home page). `/__webjs/*` is exempt, because
`/__webjs/ready` is the healthcheck the deploy gates on.

The target origin comes from `SITE_URL`, falling back to `https://webjs.dev`.

## Why the docs moved

Two costs, both structural. In search, a subdomain accrues authority to
itself rather than to `webjs.dev`, and the docs are the largest body of
indexable content the project has. In design, the docs carried their own
layout, nav, and footer, so a reader crossing over from the marketing site
left one design system and entered another. Serving the docs as a path on
the main domain removes both at once. See webjsdev/webjs#1098.

## Run

```sh
cd docs && npm run dev          # http://localhost:5002, redirects everything
```

---

Framework-wide rules and full API reference:

@../AGENTS.md
