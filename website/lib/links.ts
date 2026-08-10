import { html } from '@webjsdev/core';

/**
 * Shared, browser-safe link config for the site chrome (header + footer),
 * imported by both app/layout.ts and app/page.ts so the paths and the new-tab
 * cue are declared once instead of duplicated across the two files.
 *
 * Every entry is a literal. There is no env read here any more: the docs and
 * the component gallery used to be sibling apps needing a configurable URL
 * each, and both moved in-app (#1098, #1099), so what is left is same-origin
 * paths and a few fixed external URLs.
 */

/**
 * The documentation is served by THIS app under /docs, so it is a plain
 * same-origin path rather than an env-configured sibling URL. Keeping the
 * docs on the main domain is deliberate: a subdomain accrues its own
 * authority in search instead of contributing to webjs.dev, and it carried
 * its own layout that drifted from this one. `docs.webjs.dev` still
 * resolves, permanently redirecting into these paths.
 */
export const DOCS_PATH = '/docs';
export const DOCS_START_PATH = '/docs/getting-started';

/**
 * The component library is served by THIS app under /ui, for the same reasons
 * the docs are: a subdomain accrues its own authority in search instead of
 * contributing to webjs.dev, and ui.webjs.dev carried a second layout that had
 * drifted from this one. `ui.webjs.dev` still resolves, permanently
 * redirecting into these paths, and its /registry endpoints keep answering
 * because already-published CLI versions fetch from them.
 */
export const UI_PATH = '/ui';

/**
 * The feature gallery is its own deployed WebJs app (a scaffolded app running
 * the framework's own demos), so unlike the docs and the component library it
 * is a real cross-origin URL rather than a path this app serves. It opens in a
 * new tab for that reason: the client router only handles same-origin links,
 * and sending a reader off-site mid-visit is the case the new-tab cue exists
 * for.
 */
export const GALLERY_URL = 'https://gallery.webjs.dev';
export const GH_URL = 'https://github.com/webjsdev/webjs';
export const DISCORD_URL = 'https://discord.gg/qZScjWWNA8';
export const X_URL = 'https://x.com/webjsdev';
export const BLUESKY_URL = 'https://bsky.app/profile/webjs.bsky.social';

/**
 * Every canonical property this project owns, declared once (#1100).
 *
 * Search engines have no way to know that webjs.dev, the GitHub repo, the npm
 * packages, and the social profiles are one entity rather than unrelated pages
 * that happen to contain the same string. That matters more here than for most
 * projects, because the name is genuinely contested: a dormant Java framework,
 * a small client-side toolkit, and whatsapp-web.js all answer to some spelling
 * of it. A `sameAs` array is the explicit statement that resolves them.
 *
 * Every JSON-LD node that identifies the PROJECT imports THIS array, so no
 * two of them can drift apart. That is the Organization and the
 * SoftwareApplication on the home page plus the SoftwareApplication on
 * /what-is-webjs, and any later one, since the test derives the carriers from
 * what is rendered rather than from a list. The WebSite node is not one of
 * them: it describes this site as a document collection, not the project.
 *
 * Only list a property that resolves and is project-controlled. A dead URL in
 * `sameAs` is a negative signal, so a shorter verified list beats a longer
 * aspirational one. Every entry below was probed before being added.
 */
export const SAME_AS = [
  GH_URL,
  'https://www.npmjs.com/package/webjsdev',
  'https://www.npmjs.com/package/create-webjs',
  'https://www.npmjs.com/package/@webjsdev/core',
  X_URL,
  BLUESKY_URL,
  'https://dev.to/webjs',
  'https://webjs.hashnode.dev',
  'https://medium.com/@webjsdev',
  'https://www.facebook.com/webjs',
  'https://www.instagram.com/webjs_dev/',
  DISCORD_URL,
];

// Visually-hidden cue appended inside target="_blank" links so a screen reader
// announces the new-tab context change.
export const NEW_TAB = html`<span class="sr-only"> (opens in a new tab)</span>`;
