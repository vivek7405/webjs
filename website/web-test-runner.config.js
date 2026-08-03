/**
 * Web Test Runner configuration for the webjs marketing website.
 *
 * Browser tests live in a `browser/` subfolder of a feature folder, the
 * same feature-first layout the framework and scaffolded apps use:
 *
 *   test/<feature>/browser/*.test.js
 *
 * Node tests (the highlight tokenizer, etc.) stay on node:test and run
 * via `webjs test` (which skips anything under `browser/`).
 *
 * Run:
 *   npm test              # node + browser (webjs test)
 *   npm run test:browser  # browser only (webjs test --browser)
 */
import { playwrightLauncher } from '@web/test-runner-playwright';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Strip TypeScript types via Node's built-in `module.stripTypeScriptTypes`
 * so the browser can `import()` the app's .ts source directly, exactly the
 * way `webjs dev` serves it. No bundler, no esbuild. Mirrors the framework's
 * own root web-test-runner.config.js.
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
  files: ['test/**/browser/**/*.test.js'],
  nodeResolve: true,
  plugins: [stripTypesPlugin()],
  // Playwright launches headless browsers with `--hide-scrollbars`, which makes
  // every scrollbar zero-width. That hides a whole class of real layout bug:
  // #1147 (the docs drawer's scroll lock shifting the fixed site header) only
  // reproduces when the scrollbar takes LAYOUT WIDTH, so under the default flag
  // the regression test would pass vacuously and prove nothing. The root
  // web-test-runner.config.js drops the flag for the same reason (#1144).
  browsers: [
    playwrightLauncher({
      product: 'chromium',
      launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
    }),
  ],
  testFramework: {
    config: { ui: 'tdd', timeout: 10000 },
  },
};
