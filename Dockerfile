# Single image for the whole monorepo — website, docs, blog. Each
# Railway service runs the same image with a different start command.
# Locally: `docker compose up --build` runs all three via compose.yaml.
#
# No build step for JS — webjs serves .ts directly, Node 22+ strips types.
# Tailwind CSS IS built at image time (CLI, no browser runtime). The blog
# runs `prisma generate` at build and `prisma migrate deploy` at start.
FROM node:22-alpine

# openssl is required by Prisma's query engine at runtime.
RUN apk add --no-cache openssl ca-certificates

WORKDIR /app

# --- 1. Install deps (layer cached on manifest changes only) ------------
# Copy every workspace manifest before source so dep changes don't bust
# the source layer and vice versa.
COPY package.json package-lock.json ./
COPY packages/cli/package.json            ./packages/cli/
COPY packages/core/package.json           ./packages/core/
COPY packages/server/package.json         ./packages/server/
COPY packages/webjs-plugin/package.json   ./packages/webjs-plugin/
COPY examples/blog/package.json           ./examples/blog/
COPY website/package.json                 ./website/
COPY docs/package.json                    ./docs/

RUN npm install --no-audit --no-fund

# --- 2. Copy source -----------------------------------------------------
COPY packages  ./packages
COPY examples  ./examples
COPY website   ./website
COPY docs      ./docs

# --- 3. Build-time work --------------------------------------------------
# Blog: generate Prisma client (needs schema.prisma in context).
RUN cd examples/blog && npx prisma generate

# Tailwind: compile per-app CSS (all three use the CLI, no browser runtime).
RUN npx tailwindcss -i website/public/input.css      -o website/public/tailwind.css      --minify \
 && npx tailwindcss -i docs/public/input.css         -o docs/public/tailwind.css         --minify \
 && npx tailwindcss -i examples/blog/public/input.css -o examples/blog/public/tailwind.css --minify

# Defaults — Railway / compose override per service.
ENV NODE_ENV=production
CMD ["node", "--help"]
