# @webjsdev/ui-registry

Internal: sources for the `@webjsdev/ui` component registry.

Not published. `registry.json` is the manifest, and the files it points at
are the source of truth. The marketing site composes shadcn-compatible JSON on
demand from these sources and serves it at
`https://webjs.dev/ui/registry/<name>.json`, which the `@webjsdev/ui` CLI
fetches. There is no build step, no generated output, no `prestart` hook.

The composer and the routes moved out of this package with #1099, when the
gallery merged into the marketing site. The old `ui.webjs.dev/registry/**`
URLs still resolve, permanently redirecting to the new ones, because
already-published CLI versions fetch from them.

## Layout

```
components/        one .ts per shadcn component (web component port, light DOM + Tailwind)
lib/               shared lib code shipped into user projects (utils.ts → cn)
themes/
  index.css        neutral @theme block + CSS variables (light + dark defaults)
  base-colors.js   per-base-colour overrides (stone, zinc, mauve, olive, mist, taupe) + mergeThemeCss
registry.json      manifest read by the website composer at request time
```

Only `theme-neutral` is in `registry.json`. The other 6 base colours are
synthesized by the composer at request time: neutral CSS + per-colour
overrides → merged CSS, same `files[]` shape.

## Wire endpoints

Served by the marketing site (`website/modules/ui/queries/registry.server.ts`
composes, `website/app/ui/registry/**` routes):

- `GET /ui/registry/<name>.json`: single registry item (`type: registry:ui` /
  `registry:theme` / `registry:lib`), with file contents inlined.
- `GET /ui/registry/index.json`: flat metadata-only list.
- `GET /ui/registry`: full manifest with every item's content inlined.
