/**
 * Web Test Runner configuration for webjs.
 *
 * Runs client-side tests (renderer, directives, components, signals,
 * slots, UI components) in real browsers via Playwright. Server-side
 * tests (router, SSR pipeline, actions, auth) stay on node:test.
 *
 * Browser tests live next to the package they cover, inside a
 * `browser/` subfolder of a feature folder:
 *
 *   packages/core/test/<feature>/browser/*.test.js
 *   packages/ui/test/<feature>/browser/*.test.js
 *
 * Cross-package browser tests live at the root:
 *
 *   test/<feature>/browser/*.test.js
 *
 * Run:
 *   npx wtr                           # all browser tests
 *   npm test                          # all node tests
 *   npm run test:all                  # everything
 */
import { playwrightLauncher } from '@web/test-runner-playwright';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Custom WTR plugin: strip TypeScript types via Node 24+'s built-in
 * `module.stripTypeScriptTypes` so browsers can `import()` .ts files
 * directly. Mirrors what `webjs dev` does in production. No esbuild,
 * no separate toolchain. Only erasable TS is supported (enum / namespace
 * with values / parameter properties / legacy decorators throw and the
 * test bundle will fail loudly with a clear error).
 *
 * @returns {import('@web/test-runner').TestRunnerPlugin}
 */
function stripTypesPlugin() {
  return {
    name: 'webjs-strip-types',
    resolveMimeType(context) {
      if (context.path.endsWith('.ts') || context.path.endsWith('.mts')) return 'js';
    },
    transform(context) {
      if (!context.path.endsWith('.ts') && !context.path.endsWith('.mts')) return;
      const src = typeof context.body === 'string' ? context.body : null;
      if (src == null) return;
      return { body: stripTypeScriptTypes(src) };
    },
  };
}

export default {
  files: [
    'packages/*/test/**/browser/**/*.test.js',
    'test/**/browser/**/*.test.js',
    // Blog E2E needs `examples/blog`'s dev server running on :3456 first.
    // It runs via `npm run test:browser:blog` (separate orchestrator),
    // not the default `wtr` run.
    '!test/examples/blog/browser/**/*.test.js',
    // The browser-test-harness fixture (#806) is run by its OWN scaffold config
    // (via `wtr --config` in test/e2e/browser-harness.test.mjs), NOT this root
    // config, since it exercises the harness middleware + importmap.
    '!test/e2e/fixtures/**/*.test.js',
  ],
  nodeResolve: true,
  plugins: [stripTypesPlugin()],
  // Run the browser suite on all three engines Playwright ships (#774).
  // Chromium alone left WebKit-only repaint/layout bugs (the iOS sticky-header
  // class behind #610) uncaught in CI; webjs avoids browser-specific APIs so the
  // same tests run on each. WTR runs the browsers concurrently, and an engine
  // can be narrowed for a fast local loop with WEBJS_BROWSERS, e.g.
  // `WEBJS_BROWSERS=chromium npx wtr`.
  // Playwright launches headless browsers with `--hide-scrollbars`, which makes
  // every scrollbar zero-width. That hides a whole class of real layout bug:
  // #1144 (a dialog's scroll lock shifting a fixed header) only reproduces when
  // the scrollbar takes LAYOUT WIDTH, so under the default flag the regression
  // test would have passed vacuously. Chromium is the engine that shows a
  // classic scrollbar once the flag is dropped, so it carries that coverage.
  browsers: (process.env.WEBJS_BROWSERS
    ? process.env.WEBJS_BROWSERS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['chromium', 'firefox', 'webkit']
  ).map((product) =>
    playwrightLauncher(
      product === 'chromium'
        ? { product, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } }
        : { product },
    ),
  ),
  testFramework: {
    config: {
      ui: 'tdd',
      timeout: 10000,
    },
  },
};
