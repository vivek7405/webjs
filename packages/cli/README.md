# @webjsdev/cli

CLI for [webjs](https://github.com/webjsdev/webjs): scaffold, develop,
build, and run webjs apps.

Installing this package gives you the `webjs` command.

## Install

Install once, globally:

```sh
npm i -g webjsdev
```

Then scaffold a new app anywhere:

```sh
webjs create my-app
cd my-app && npm run dev
# → http://localhost:8080
```

One-shot without a global install, two ways:

```sh
# Preferred: the npx-discoverable scaffolder
npx create-webjs-app@latest my-app
cd my-app && npm run dev

# Or via the CLI's npx entry directly
npx @webjsdev/cli create my-app
cd my-app && npm run dev
```

Both `webjs create` and `create-webjs-app` auto-install dependencies in the new directory using your detected package manager (npm / pnpm / yarn / bun). Pass `--no-install` to opt out.

## Commands

```sh
webjs create <name>            # scaffold a full-stack app (default; auth ships as a gallery card)
                               # <name> must be a valid package name: letters, digits,
                               # and - . _ , starting with a letter or a digit
webjs create <name> --template api   # backend-only API app (routes + modules + Drizzle)

webjs dev                      # dev server with live reload (runs webjs.dev.before, e.g. webjs db migrate, then serves; npm run dev is a thin alias)
webjs start                    # production server (no build step, serves source directly)
webjs check                    # validate source-code conventions (CI gate)
webjs doctor                   # verify the project/toolchain setup (per-check severity via webjs.doctor.gate, so CI can gate a subset)
webjs test                     # run server + browser tests
webjs vendor pin [--download]  # pin client deps to a committable importmap (offline/reproducible)
webjs db <generate|migrate|push|studio|seed>   # drizzle-kit passthrough (+ seed)

webjs ui init                  # initialise @webjsdev/ui in this project
webjs ui add <names...>        # copy components from the registry (https://webjs.dev/ui/registry/<name>.json)
webjs ui list                  # list every component available in the registry
```

`webjs ui` proxies to [`@webjsdev/ui`](https://www.npmjs.com/package/@webjsdev/ui),
an AI-first component library + CLI that copies sources into your project: class
helpers (`buttonClass`, `cardClass`, …) for the visual primitives and a small set
of stateful custom elements (`<ui-dialog>`, `<ui-tabs>`, `<ui-popover>`) where
state matters. The package is a hard dependency of `@webjsdev/cli`, so installing
the CLI gives you `webjs ui` automatically. See
[https://webjs.dev/ui](https://webjs.dev/ui) for the catalogue.

## Scaffolded templates

The scaffold seeds opinionated defaults so AI agents produce consistent code:

- `AGENTS.md` + `.agents/skills/webjs/` (single cross-agent source of truth, no per-agent rule files)
- `.agents/rules/workflow.md` & a git `.hooks/pre-commit`
- `test/<feature>/` (with optional `browser/` / `e2e/` subfolders per kind) with example tests
- Tailwind CSS via CLI (no browser runtime at build time)
- TypeScript, `.editorconfig`, `.gitignore`

See the full framework docs at https://github.com/webjsdev/webjs.

## License

MIT
