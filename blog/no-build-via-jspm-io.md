---
title: "No-Build npm Packages with Import Maps and jspm"
date: 2026-05-27T11:00:00+05:30
slug: no-build-via-jspm-io
description: "How WebJs loads no-build npm packages by putting jspm.io CDN URLs directly in the import map, no esbuild bundler, matching Rails 7's importmap-rails, plus the SRI and CSP hardening that fell out."
tags: no-build, importmap, jspm, vendor, csp, sri
author: Vivek
---

WebJs makes one big promise. No build step. The `.ts` files you write are the files that run, with nothing compiling them in between. The earlier post on stripping types is where that promise started for user code. The dev server picks up your `.ts` file, runs `module.stripTypeScriptTypes`, and serves the result. Stack traces line up with the source on disk. No sourcemap layer. That covered every file under `app/`, `components/`, `modules/`, and `lib/`.

It did not cover npm packages.

For a long stretch, every `import x from 'pkg'` in a client file went through an on-the-fly esbuild bundle (esbuild is a fast JavaScript bundler). The server scanned bare imports (an import by package name like `dayjs`, not a file path) at boot, resolved each to a node_modules entry, ran esbuild over the resulting graph, and cached the bundle under `/__webjs/vendor/<hash>.js`. The browser fetched the bundle and ran it. From the user's perspective the import "just worked." From the framework's perspective there was still a bundler hidden inside the server.

It worked. It was fast (esbuild does 10MB/s). But the framework was no longer no-build. It was no-build-for-your-code-but-secretly-bundles-vendor. Every blog post about WebJs being no-build had a footnote in my head.

The PR that just shipped (#89, merge `988b37b`) removes esbuild from the framework entirely. There is no longer a bundler anywhere in the runtime path. Vendor packages resolve through jspm.io's CDN directly, exactly like Rails 7 does with importmap-rails.

# What I looked at

Three options were on the table when I started.

**Keep on-the-fly esbuild.** Familiar. Already worked. But it conceded the no-build claim and kept esbuild as a runtime dependency, which is a 30MB native binary that has to match the server's CPU architecture and Node ABI. Every CI matrix and every deploy target had to ship the right esbuild for the platform.

**Switch to esm.sh.** I started here because esm.sh is the obvious "free CDN that serves npm as ESM" answer (ESM is the native JavaScript module format browsers load directly) when you type the question into a search box. The shape is similar to what I wanted. You write a URL like `https://esm.sh/dayjs@1.11.13` and the browser fetches a working ESM module.

The problem is that esm.sh builds packages on the fly. When your browser hits a URL it has not seen before, esm.sh's server pulls the package from npm, runs its own build pipeline, and streams the result back. The output is cached for subsequent requests, but the first hit is a build. This shows up as latency spikes, and more visibly as availability incidents. esm.sh has had multiple production-visible outages over its lifetime. The maintainers post recovery notes on GitHub and Twitter when they happen. The combination of "build on the fly" + "free service" + "one maintainer" is real, and the incidents are public.

**Switch to jspm.io.** jspm.io pre-builds every npm package and parks the result on its CDN. There is no on-the-fly anything at request time. When the browser fetches `https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js`, the bytes are already on disk at the edge. Zero reported incidents in years. Zero maintenance downtime. The maintainer is Guy Bedford, a TC39 member (TC39 is the committee that standardizes JavaScript) who championed import maps (the browser-native map from a bare package name to a URL) and contributed to the HTML spec for ESM. Rails 7's `importmap-rails` uses jspm.io for the same reason: it is the boring, battle-tested choice.

I went with jspm.io.

# What the resolver looks like

At server boot, the bare-import scanner walks client-reachable source and produces a set of bare specifiers. The set is sent to `api.jspm.io/generate` as a single POST, which returns a fully-resolved importmap fragment. The fragment goes into the SSR-emitted `<script type="importmap">` verbatim.

```html
<script type="importmap" data-webjs-build="bcf0b61d...">
{
  "imports": {
    "dayjs": "https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js",
    "zod":   "https://ga.jspm.io/npm:zod@3.23.8/lib/index.mjs"
  }
}
</script>
```

The browser fetches each package directly from `ga.jspm.io`. WebJs's server is never on the bytes path for vendor traffic. The dev server's job at request time is to serve user code; the importmap takes care of everything else.

# `webjs vendor pin` commits the resolved URLs

For production, calling `api.jspm.io/generate` on every cold boot is a runtime dependency on jspm.io's API (not the CDN). The fix is to resolve once, commit the result, and read from disk on subsequent boots:

```sh
$ webjs vendor pin
Pinning vendor packages from /home/me/my-app...
  dayjs@1.11.13
  zod@3.23.8
Pinned 2 packages, wrote .webjs/vendor/importmap.json.
```

The pin file goes in git. Deploys read it on boot, no jspm.io API call needed. Browsers still fetch the bytes from `ga.jspm.io` at runtime, but the resolution is frozen.

Pin is intentionally manual. There is no auto-pin in `predev` or `prestart` because that would churn the committed importmap.json on every dev cycle as jspm.io's resolver drifts (point releases of transitive deps, etc.). Rails takes the same posture: `bin/importmap pin` is always developer-invoked.

# `webjs vendor pin --download` for air-gapped deploys

Some deploys cannot reach a third-party CDN at runtime. Compliance-locked environments, air-gapped corporate networks, or strict-CSP setups (Content Security Policy, the browser rules for which scripts are allowed to run) with `script-src 'self'` only. For those, the `--download` flag also pulls the bundle bytes to `.webjs/vendor/<pkg>@<version>.js` and rewrites the importmap to local `/__webjs/vendor/` paths.

```sh
$ webjs vendor pin --download
Pinning vendor packages from /home/me/my-app (downloading bundles)...
  dayjs@1.11.13                            8.2 KB
  zod@3.23.8                               12.5 KB
Pinned 2 packages, wrote .webjs/vendor/importmap.json + 2 bundles.
```

The bundle files go in git alongside the pin manifest. At runtime the server serves them from disk with `cache-control: public, max-age=31536000, immutable` and an ETag for downstream caches that strip the immutable directive. The browser never touches `ga.jspm.io` after the pin step. Suitable for `script-src 'self'` CSP, air-gapped deploys, and any compliance environment that refuses third-party origins.

# SHA-384 integrity end-to-end

Once the resolution is committed, the SRI story (Subresource Integrity, the browser check that a downloaded file matches an expected hash) falls into place. Both pin modes compute a `sha384-<base64>` integrity hash for every URL the importmap emits. In default mode the hash is computed by fetching the jspm.io URL once at pin time and hashing the raw response bytes. In `--download` mode the hash is computed from the downloaded bundle, which is also what the browser later fetches from `/__webjs/vendor/`.

Hashes land in three places:

1. The pin file's `integrity` field, alongside `imports`. This is the [importmap-integrity spec](https://wicg.github.io/import-maps/) (Chrome 132+, Safari 18.4+, Firefox flagged).
2. The `integrity="..."` attribute on every `<link rel="modulepreload">` the SSR pipeline emits.
3. The same attribute, propagated by the client router, when it stamps modulepreload links onto the document after a partial-swap navigation.

If jspm.io's CDN is compromised and starts serving different bytes, the browser refuses to execute the new code. The integrity check is the defense.

# CSP nonce, end to end

While I was already in the request pipeline, I followed Turbo Drive's CSP-nonce pattern and threaded a per-request nonce through every SSR path. Server emits `<meta name="csp-nonce" content="...">` once at SSR time. Every inline script (boot module, importmap, env shim, Suspense resolution) carries `nonce="..."`. Every modulepreload link carries the same nonce. The client router reads that meta tag and stamps the original document's nonce onto every dynamically-inserted script and link, so head-merge during partial swaps does not get blocked by strict CSP.

A nonce-based `script-src` is now enough for a WebJs app, with no `'unsafe-inline'` and no `'unsafe-eval'` among the script sources. The default pairs the nonce with `'strict-dynamic'`, which is the part that lets a nonce-loaded module pull in its own importmap-driven dependency graph without every URL being allow-listed by hand.

`style-src` is the directive that still permits inline styles, and it has to, because it carries no nonce source at all. The nonce covers scripts only, so every inline style in the document is admitted by `'unsafe-inline'`, including the one rule WebJs itself writes into the head. What makes the allowance hard to give up is the app's own styling: a light-DOM component's `<style>` block in `render()`, a shadow component's `static styles`, an inline `<style>` written by a page or layout. Then there are `style="..."` attributes, which no nonce can ever reach, because the nonce mechanism applies to elements and there is no such thing as a nonce on an attribute. A style element is not a script-injection vector, so none of this weakens the script protection. Run a strict CSP and the app still works.

# What this lets us delete

The before-and-after diff:

- The on-the-fly esbuild bundler: gone. Removed from `@webjsdev/server`'s dependencies.
- The `/__webjs/vendor/<hash>` server route that served bundles in default mode: gone. The `/__webjs/vendor/` path now exists only in `--download` mode and serves static files from disk.
- The bundle-cache invalidation logic: gone. There is no cache to invalidate because there is no bundling at request time.
- The transitive-dep bundle traversal: gone. jspm.io's resolver handles it; we ask for `dayjs@1.11.13` and the importmap returns the right URLs for everything dayjs imports.
- The esbuild dependency on every CI matrix: gone. The framework is one less native binary to ship.

# What's left

The fallback path. Plain `.ts` files in user code occasionally use non-erasable syntax. When `module.stripTypeScriptTypes` throws on those, the dev server returns a clean 500 pointing at the `no-non-erasable-typescript` lint rule. There is no more "fall back to esbuild" branch. If you want enum, you use the `as const` equivalent. If you want decorators with metadata, that conversation moved upstream to the TC39 decorators proposal.

The `webjs check` rules `erasable-typescript-only` and `no-non-erasable-typescript` enforce this at edit time. Most editors flag it as a red squiggle before commit. The CI gate is the same rule run from the framework.

# What it means for users

For someone writing a WebJs app: `npm install dayjs`, then `import dayjs from 'dayjs'` in any client file. The import works in dev immediately, no `webjs vendor` call needed. The scanner discovers the new bare import and asks jspm.io at the next boot.

For someone deploying a WebJs app: run `webjs vendor pin` once, commit `.webjs/vendor/importmap.json`, and your deploys are deterministic. Add `--download` if you need air-gapped or strict-CSP behavior.

For someone debugging a WebJs app: the network panel shows real package URLs (`ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js`) instead of opaque content-addressed hashes. You can paste any vendor URL into a fresh tab and read the same bytes the browser is running.

For someone running CI: no esbuild binary to install. The framework ships zero native dependencies. `node --test` runs against the real source.

# The honest part

This took longer than the strip-types post, by a meaningful margin. The PR went through six review passes. Real bugs surfaced in each one, including a defense-in-depth gap where HTML5's script-data-escaped state could break out of a maliciously-crafted importmap, an attribute-injection vector through hand-edited pin files, and an importmap-drift detection blind spot on X-Webjs-Have partial responses. Each got a regression test verified by reverting the fix and watching the test fail.

The net result is a framework with no bundler in its request path and a vendor pipeline that matches the boring, battle-tested choice the Rails team made. Same CDN. Same posture. Same trust model.

WebJs is now no-build end-to-end. The `.ts` files you write are the files that run. The npm packages you install are fetched from jspm.io as pre-built ESM. There is no compile step, no bundle step, no transform step at request time. The framework is smaller after this PR than before, by a meaningful chunk of code.

That is the last bundler removed. There was no surprise to it: I knew the architecture I wanted, I knew Rails had already shipped it, and the work was finding the right places to put SRI and CSP so the result was safe under strict policies. The interesting parts were the review iterations on the security surfaces.

The site is at [webjs.dev](https://webjs.dev). The repo is at [github.com/webjsdev/webjs](https://github.com/webjsdev/webjs). To scaffold an app with the new pipeline:

```sh
npm create webjs@latest my-app
cd my-app && npm install dayjs zod
# write some imports, then for prod:
webjs vendor pin
```
