/**
 * Web Test Runner configuration for webjs.
 *
 * Runs client-side tests (renderer, directives, components) in real browsers
 * via Playwright. Server-side tests (router, SSR, actions) stay on node:test.
 *
 * Run:
 *   npx wtr                           # client + component tests
 *   npm test                          # server tests (node:test)
 *   npm run test:all                  # everything
 */
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: ['test/browser/render-client.test.js', 'test/browser/light-dom-hydration.test.js'],
  nodeResolve: true,
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
  ],
  testFramework: {
    config: {
      ui: 'tdd',
      timeout: 10000,
    },
  },
};
