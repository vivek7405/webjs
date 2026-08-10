# Single image for the whole monorepo. Each Railway service runs the
# same image with a different start command. Locally:
# `docker compose up --build` runs both via compose.yaml.
#
# No build step for JS. webjs serves .ts directly by stripping types at the
# runtime layer (position-preserving whitespace replacement, no sourcemap shipped
# to the browser). webjs is buildless end to end; there is NO bundler or esbuild
# fallback.
#
# The image carries BOTH runtimes by design. The BUILD toolchain runs on Node
# (npm install, the core dist bundle, Tailwind), which keeps
# the proven buildless toolchain unchanged; **Node 24+ is REQUIRED** there (the
# built-in `module.stripTypeScriptTypes` stripper and recursive fs.watch need it),
# which is why the base pins a current Node major. The SERVING process runs on
# Bun: each service's start command is `bun ... webjs.js start`, so `startServer`
# selects the native `Bun.serve` listener shell (more req/s on the listening path)
# and strips `.ts` via `amaro`. The one behavioral difference from the node:http
# shell is that 103 Early Hints are node-only (Bun.serve has no informational-
# response API), so the modulepreload head-start is dropped on Bun; the preloads
# still ship in the document head. The Bun binary is copied from the official
# `oven/bun` image below; nothing is BUILT on Bun, so there is no build-toolchain
# risk.
#
# Tailwind CSS IS built at image time (CLI, no browser runtime). The
# blog applies its Drizzle migrations (`webjs db migrate`) at start via
# `webjs.start.before`; there is no DB codegen step.
FROM node:26-alpine

# ca-certificates for outbound TLS (e.g. the jspm vendor resolve); openssl is
# kept as a small, harmless base lib several native modules link against.
RUN apk add --no-cache openssl ca-certificates

# Drop the Bun binary into the Node image (musl/alpine build) so the serving
# process runs on Bun while the build steps keep using Node. `COPY --from=<image>`
# pulls only the static binary, no extra layers. The dockerfile-copy-paths
# repo-health test skips `--from=` lines, so this image source is not validated
# as a repo path.
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# --- 1. Install deps (layer cached on manifest changes only) ------------
# Copy every workspace manifest before source so dep changes don't bust
# the source layer and vice versa.
COPY package.json package-lock.json ./
COPY packages/cli/package.json                       ./packages/cli/
COPY packages/core/package.json                      ./packages/core/
COPY packages/mcp/package.json                       ./packages/mcp/
COPY packages/server/package.json                    ./packages/server/
COPY packages/editors/intellisense/package.json         ./packages/editors/intellisense/
COPY packages/ui/package.json                        ./packages/ui/
COPY packages/ui/packages/registry/package.json      ./packages/ui/packages/registry/
COPY examples/blog/package.json                      ./examples/blog/
COPY gallery/package.json                            ./gallery/
COPY website/package.json                            ./website/

# Copy the CLI's bin/ before install so npm can symlink it into
# /app/node_modules/.bin/webjs. Without this, the bin target doesn't
# exist at install time and npm silently skips the symlink - then
# `npm start` inside any workspace fails with `sh: webjs: not found`.
COPY packages/cli/bin                     ./packages/cli/bin

RUN npm install --no-audit --no-fund

# --- 2. Copy source -----------------------------------------------------
COPY packages  ./packages
COPY examples  ./examples
COPY gallery   ./gallery
COPY website   ./website
# scripts/build-framework-dist.js is invoked by the step-3
# `npm run build:dist --workspace=@webjsdev/core` line, so the
# scripts tree has to be in the image before that step runs.
COPY scripts   ./scripts
# website/app/changelog/page.ts reads ../../../changelog/<pkg>/*.md at
# SSR time. Without copying the changelog tree into the image, the
# deployed page renders "No entries yet."
COPY changelog ./changelog
# website/app/blog/[slug]/page.ts reads ../../../../blog/<slug>.md at
# SSR time (via modules/blog/queries/list-posts.server.ts). Same
# reason as changelog: without the tree in the image, /blog renders
# "No posts yet."
COPY blog ./blog
# website/app/compare/[slug]/page.ts and app/sitemap.ts read
# ../../../../compare/<slug>.md at SSR time (via
# modules/compare/queries/*.server.ts). Same reason as blog: without the
# tree in the image, /compare renders "No comparisons yet."
COPY compare ./compare
# website/app/articles/[slug]/page.ts and app/sitemap.ts read
# ../../../../articles/<slug>.md at SSR time (via
# modules/articles/queries/*.server.ts). Same reason as compare: without
# the tree in the image, /articles renders "No articles yet."
COPY articles ./articles

# --- 3. Build-time work --------------------------------------------------
# Core: build the dist/ bundles. The package.json `prepare` hook is a
# self-guarded no-op during step 1 (manifests-only npm install, before
# scripts/ and packages/core/src/ are copied in), so the bundle has to
# be built explicitly here, after sources land. Without this step,
# production images serve per-file from src/ via the workspace-dev
# fallback, which is functional but waterfalls the browser through ~15
# requests per page instead of one chunk per subpath.
RUN npm run build:dist --workspace=@webjsdev/core

# Blog: no DB codegen step. Drizzle has no generated client (the schema IS the
# types). The committed migrations are applied at container START by the blog's
# `webjs.start.before` (`webjs db migrate`), not at build time.

# UI registry: the registry JSON is composed on demand by the route handlers
# (no build step). But the gallery's component DETAIL pages statically import
# the component SOURCES from `components/ui/*.ts`, which are a gitignored
# mirror of packages/ui/packages/registry/. A start command that serves
# directly (the `bun webjs.js start` form, which bypasses npm `prestart`, the
# same way the Tailwind step below is needed) would 500 on every component page
# without these files, so bake them at build time here. The mirror now lands in
# the marketing app, since that is where the gallery lives (#1099).
# `copy-registry.mjs` is pure filesystem (no runtime / network / DB), so it is
# build-safe, and it MUST run before the Tailwind step below: the generated
# sources are a scanned @source, so their utility classes are missing from the
# stylesheet otherwise.
RUN cd website && node scripts/copy-registry.mjs

# Tailwind: compile per-app CSS (every app with a stylesheet uses the CLI, no
# browser runtime).
# Each compose service's command invokes `webjs.js start` directly, which
# bypasses the per-package `prestart: css:build` hook in npm; the CSS has
# to be ready in the image. Keep this list in sync with the apps that
# have a public/input.css and a `css:build` script in their package.json.
RUN npx tailwindcss -i website/public/input.css                       -o website/public/tailwind.css                       --minify \
 && npx tailwindcss -i examples/blog/public/input.css                 -o examples/blog/public/tailwind.css                 --minify \
 && npx tailwindcss -i gallery/public/input.css                       -o gallery/public/tailwind.css                       --minify

# Default env vars. Railway / compose set their own per service.
ENV NODE_ENV=production

# Platform-neutral readiness gate (mirrors packages/cli/templates/Dockerfile,
# the pattern the scaffold ships to users). webjs answers /__webjs/ready with
# 503 until the instance is fully warm (analysis + first vendor attempt), then
# 200. This image-level HEALTHCHECK is honoured by Docker, compose, and most
# Docker-based platforms, so the readiness gate works the same everywhere
# without a per-platform file. Each service sets its own PORT (compose env, or
# Railway injects it); the probe reads it, defaulting to 8080. Dependency-free
# (Node's built-in fetch, no curl/wget). Platforms that read their own config
# point the equivalent knob at the same path (Railway healthcheckPath in
# railway.json, Fly [checks], k8s readinessProbe).
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/__webjs/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "--help"]
