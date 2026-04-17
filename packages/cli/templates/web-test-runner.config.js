/**
 * Web Test Runner configuration.
 *
 * Runs browser tests (components, directives, interactions) in real
 * Chromium via Playwright. Server tests (actions, queries) use node:test.
 *
 * Run:
 *   npx webjs test              # runs both server + browser tests
 *   npx webjs test --browser    # browser tests only
 *   npx webjs test --server     # server tests only
 */
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: ['test/browser/**/*.test.js'],
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
