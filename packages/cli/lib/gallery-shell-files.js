/**
 * The files the canonical `gallery/` app owns only because it is a RUNNABLE
 * WebJs app, and which the scaffold (`webjs create`) generates itself.
 *
 * `gallery/` is both the single source of the scaffold's feature gallery AND a
 * live app deployed on its own, so it needs a root layout, a home page, a theme
 * toggle, and the `cn()` helper. The scaffold writes all four itself, with
 * things the gallery's copies cannot carry: the app's `displayName`, the
 * `cspNonce()` wiring, `LayoutProps` typing, the `metadata.icons` favicon, and
 * a `cn.ts` read verbatim from the `@webjsdev/ui` registry so `webjs ui add`
 * stays in lockstep with the kit.
 *
 * So they are the ONE part of `gallery/` that is not scaffold payload. They are
 * dropped from the published bundle (`scripts/sync-scaffold-gallery.mjs`) and
 * skipped by `copyGallery()` so monorepo-dev and installed-npm scaffolding emit
 * byte-identical apps. Paths are POSIX-relative to the gallery root.
 *
 * @type {readonly string[]}
 */
export const GALLERY_APP_SHELL_FILES = Object.freeze([
  'app/layout.ts',
  'app/page.ts',
  'components/theme-toggle.ts',
  'lib/utils/cn.ts',
]);

/**
 * True when `relPath` (POSIX-relative to the gallery root) is a gallery-only
 * app-shell file rather than scaffold payload.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function isGalleryAppShellFile(relPath) {
  return GALLERY_APP_SHELL_FILES.includes(relPath.split('\\').join('/'));
}
