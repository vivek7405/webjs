#!/usr/bin/env node
// Bundle the canonical scaffold gallery into the CLI package for publishing.
//
// The WebJs scaffold gallery lives ONCE, canonically, at the repo root `gallery/`.
// The scaffold (`webjs create`) ships it into every generated app, but npm's `files`
// cannot reach a repo-root path from inside `packages/cli`, so this script
// copies the canonical gallery into `packages/cli/templates/gallery/`
// at `prepack` (wired into packages/cli's prepack), just before the tarball is
// built. `postpack` runs it with `--clean` to remove the transient copy, so the
// bundle is present in the tarball but ABSENT in the working tree: the source
// stays single (no committed duplicate), and `create.js` falls back to the
// repo-root canonical when the bundle is absent (monorepo dev).
import { rm, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGalleryAppShellFile } from '../packages/cli/lib/gallery-shell-files.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(repoRoot, 'gallery');
const dest = join(repoRoot, 'packages', 'cli', 'templates', 'gallery');

if (process.argv.includes('--clean')) {
  await rm(dest, { recursive: true, force: true });
  console.error('[webjs] cleaned the transient scaffold-gallery bundle');
} else {
  if (!existsSync(src)) throw new Error(`canonical gallery not found at ${src}`);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const sub of ['app', 'modules', 'components', 'lib', 'test']) {
    const subSrc = join(src, sub);
    if (!existsSync(subSrc)) continue;
    // The gallery's own app shell (root layout, home page, theme toggle, cn.ts)
    // exists because gallery/ is a live app. The scaffold writes its own, so
    // those four are not payload and never enter the tarball.
    await cp(subSrc, join(dest, sub), {
      recursive: true,
      filter: (from) => !isGalleryAppShellFile(relative(src, from)),
    });
  }
  console.error(`[webjs] bundled the scaffold gallery into ${dest}`);
}
