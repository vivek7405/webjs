# @webjskit/cli

CLI for [webjs](https://github.com/vivek7405/webjs) — scaffold, develop,
build, and run webjs apps.

Installing this package gives you the `webjs` command.

## Install

Most users won't install globally. Scaffold a new app instead:

```sh
npx @webjskit/cli create my-app
cd my-app
npm install
npm run dev
```

Or globally:

```sh
npm install -g @webjskit/cli
webjs create my-app
```

## Commands

```sh
webjs create <name>            # scaffold a full-stack app (default)
webjs create <name> --template api   # backend-only API app
webjs create <name> --template saas  # auth + dashboard + Prisma User model

webjs dev                      # dev server with live reload
webjs start                    # production server
webjs build                    # production bundle
webjs check                    # validate project conventions
webjs test                     # run server + browser tests
webjs db <prisma-subcommand>   # prisma passthrough (saas template)
```

## Scaffolded templates

The scaffold seeds opinionated defaults so AI agents produce consistent code:

- `AGENTS.md` + `CONVENTIONS.md` (the machine-readable contract)
- `.claude/`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`
- `test/unit/` and `test/browser/` with example tests
- Tailwind CSS via CLI (no browser runtime at build time)
- TypeScript, `.editorconfig`, `.gitignore`

See the full framework docs at https://github.com/vivek7405/webjs.

## License

MIT
