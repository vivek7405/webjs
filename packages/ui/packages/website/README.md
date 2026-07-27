# @webjsdev/ui-website

A redirect-only service for `ui.webjs.dev`. It renders nothing.

The component gallery and the registry API moved to the marketing site at
`webjs.dev/ui` (#1099). This host stays alive because it can never be retired:
every already-published `@webjsdev/ui` and `@webjsdev/cli` fetches components
from `https://ui.webjs.dev/registry/<name>.json`, and a published version can
never be corrected after the fact.

## Where things live now

| What | Where |
|---|---|
| Gallery pages | `website/app/ui/**` |
| Registry API | `website/app/ui/registry/**` |
| Registry composer | `website/modules/ui/queries/registry.server.ts` |
| Component sources | `packages/ui/packages/registry/` (unchanged) |

## What this service does

`middleware.ts` permanently redirects every request to `webjs.dev`, mapping the
old URL shapes onto the new ones (`/registry/**` to `/ui/registry/**`,
`/docs/components/<name>` to `/ui/<name>`, `/` and `/docs` to `/ui`).
`/__webjs/*` stays local so the readiness probe still answers.

See [`AGENTS.md`](AGENTS.md) for the full mapping table and the reasoning.

## Dev

```sh
npm run dev      # http://localhost:5003
```

`SITE_URL` overrides the redirect target (default `https://webjs.dev`); copy
`.env.example` to `.env` to point at a local marketing app.
