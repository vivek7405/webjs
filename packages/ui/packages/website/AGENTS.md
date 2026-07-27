# AGENTS.md for ui.webjs.dev (redirect-only)

**The component gallery no longer lives here.** It is served by the marketing
site at `webjs.dev/ui`, from `website/app/ui/**`. To add or edit a gallery
page, go to [`../../../../website/AGENTS.md`](../../../../website/AGENTS.md).
The components themselves are still authored in
[`../registry/`](../registry/), which is unchanged.

This directory is now a tiny redirect-only service, and it exists for one
reason that is stronger than the equivalent docs host's: **`ui.webjs.dev` must
keep resolving forever, and `/registry/*` in particular is a LIVE API.**

## Why this service can never be deleted

`packages/ui/src/registry/fetcher.js` hardcodes
`HOSTED_REGISTRY_URL = 'https://ui.webjs.dev/registry'`. Every
already-published `@webjsdev/ui` and `@webjsdev/cli` carries that constant, and
a published version can never be corrected after the fact. When a user on an
older install runs `webjs ui add button`, their machine fetches
`https://ui.webjs.dev/registry/button.json`. If this host stops answering, that
documented command breaks for those users permanently.

Since `@webjsdev/ui@0.3.9` the kit resolves **local-first** (#983): `init`,
`add`, `list`, and `view` read the registry that ships inside the installed
package and never touch the network on the default registry. So the exposure is
versions at or below 0.3.8, plus `webjsui diff` (which deliberately compares
against the live upstream) at any version.

**A 301 is safe here, and that was verified rather than assumed** before the
move: the real published 0.3.1 and 0.3.8 tarballs were pointed at a host that
301s cross-origin, and both followed it and parsed the result, because `fetch`
follows redirects by default.

## What it does

`middleware.ts` answers every request with a permanent redirect to `webjs.dev`.
The mapping is **path-aware, not a blind prefix**, because the old URL shapes
are not the new ones:

| Old (`ui.webjs.dev`) | New (`webjs.dev`) |
|---|---|
| `/registry`, `/registry/**` | `/ui/registry`, `/ui/registry/**` |
| `/docs/components/<name>` | `/ui/<name>` |
| `/`, `/docs` | `/ui` |
| `/docs/<rest>` | `/ui/<rest>` |
| anything else | `/ui/<path>` |

A blind path-preserving redirect would have sent every existing component link
to `/ui/docs/components/<name>`, which 404s. The mapping is pinned by
`test/ui/ui-host-redirect.test.mjs`, which asserts destinations rather than the
mere presence of a redirect, because a redirect that resolves to the wrong path
looks healthy from the outside.

`/__webjs/*` is exempt so the framework's own endpoints (and the deploy's
readiness probe) still work.

The redirect carries `access-control-allow-origin: *`, because the registry is
fetched cross-origin by tooling and a redirect a browser context cannot follow
is as good as a dead endpoint.

## Configuration

`SITE_URL` sets the redirect target, defaulting to `https://webjs.dev`. Copy
`.env.example` to `.env` to point local redirects at a local marketing app.
Note that doing so makes `test/ui/ui-host-redirect.test.mjs` fail locally,
since it asserts the production origin.

## Do not

- Do not delete this service or repoint the domain at something that 404s.
- Do not add pages here. The gallery lives on the marketing site now, and a
  page added here would be unreachable anyway, since the middleware redirects
  everything.
- Do not simplify the mapping into a plain prefix redirect. See the table.

---

Framework-wide rules and full API reference:

@../../../../AGENTS.md
