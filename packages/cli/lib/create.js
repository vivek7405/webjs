/**
 * `webjs create <name>` — scaffold a new webjs app with opinionated defaults.
 *
 * Creates a directory with:
 *   - app/ with a root layout + page
 *   - modules/ skeleton
 *   - components/ with a theme toggle
 *   - test/unit/ and test/e2e/ with example tests
 *   - CONVENTIONS.md, AGENTS.md, CLAUDE.md
 *   - package.json with webjs deps + test scripts
 *   - tsconfig.json for editor support
 */

import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(__dirname, '..', 'templates');

/**
 * @param {string} name  App directory name
 * @param {string} cwd   Current working directory
 */
export async function scaffoldApp(name, cwd) {
  const appDir = join(cwd, name);
  if (existsSync(appDir)) {
    console.error(`Error: directory '${name}' already exists.`);
    process.exit(1);
  }

  console.log(`\nwebjs create: scaffolding '${name}'...\n`);

  // Create directory structure
  const dirs = [
    'app',
    'components',
    'modules',
    'lib',
    'public',
    'test/unit',
    'test/e2e',
  ];
  for (const d of dirs) await mkdir(join(appDir, d), { recursive: true });

  // --- Root files ---

  await writeFile(join(appDir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    private: true,
    scripts: {
      dev: 'webjs dev',
      build: 'webjs build',
      start: 'webjs start',
      test: 'webjs test',
      'test:server': 'webjs test --server',
      'test:browser': 'webjs test --browser',
      check: 'webjs check',
    },
    dependencies: {
      webjs: 'latest',
      '@webjs/server': 'latest',
      '@webjs/cli': 'latest',
    },
    devDependencies: {
      esbuild: '^0.28.0',
      '@web/test-runner': '^0.20.0',
      '@web/test-runner-playwright': '^0.11.0',
      'playwright': '^1.59.0',
    },
  }, null, 2) + '\n');

  await writeFile(join(appDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
    },
  }, null, 2) + '\n');

  // --- Templates (CONVENTIONS.md, CLAUDE.md, test files, Claude hooks) ---

  const templateFiles = [
    'CONVENTIONS.md',
    'CLAUDE.md',
    'test/unit/example.test.ts',
    'test/browser/example.test.js',
    'web-test-runner.config.js',
    // Git hooks (blocks commits on main)
    '.hooks/pre-commit',
    // Claude Code config + hooks
    '.claude.json',
    '.claude/settings.json',
    '.claude/hooks/guard-main-merge.sh',
    '.claude/hooks/guard-branch-context.sh',
    // Cross-agent config files
    '.cursorrules',
    '.windsurfrules',
    '.github/copilot-instructions.md',
    '.github/pull_request_template.md',
    '.editorconfig',
  ];
  for (const f of templateFiles) {
    const src = join(TEMPLATES, f);
    if (existsSync(src)) {
      await mkdir(dirname(join(appDir, f)), { recursive: true });
      let content = await readFile(src, 'utf8');
      content = content.replace(/\{\{APP_NAME\}\}/g, name);
      await writeFile(join(appDir, f), content);
    }
  }

  // Make hook scripts executable
  const { chmod } = await import('node:fs/promises');
  for (const hook of ['guard-main-merge.sh', 'guard-branch-context.sh']) {
    const hookPath = join(appDir, '.claude', 'hooks', hook);
    if (existsSync(hookPath)) await chmod(hookPath, 0o755);
  }
  // Make git pre-commit hook executable
  const preCommitPath = join(appDir, '.hooks', 'pre-commit');
  if (existsSync(preCommitPath)) await chmod(preCommitPath, 0o755);

  // --- App files ---

  await writeFile(join(appDir, 'app', 'layout.ts'), `import { html } from 'webjs';
import 'webjs/client-router';
import '../components/theme-toggle.ts';

export default function RootLayout({ children }: { children: unknown }) {
  return html\`
    <script>
      (function(){
        try {
          var t = localStorage.getItem('webjs_theme');
          if (t === 'light' || t === 'dark') {
            document.documentElement.dataset.theme = t;
          }
        } catch (_) {}
      })();
    </script>
    <style>
      :root {
        color-scheme: light dark;
        --fg: oklch(0.18 0.015 60);
        --fg-muted: oklch(0.42 0.02 65);
        --bg: oklch(0.985 0.008 80);
        --bg-elev: oklch(1 0 0);
        --border: oklch(0.88 0.01 75 / 0.95);
        --accent: oklch(0.58 0.15 55);
        --accent-fg: oklch(1 0 0);
        --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      :root[data-theme='dark'] {
        --fg: oklch(0.96 0.015 60);
        --fg-muted: oklch(0.72 0.02 60);
        --bg: oklch(0.14 0.01 55);
        --bg-elev: oklch(0.18 0.01 55);
        --border: oklch(0.26 0.012 55 / 0.9);
        --accent: oklch(0.78 0.14 55);
        --accent-fg: oklch(0.15 0.01 55);
      }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
      }
    </style>
    <header style="display:flex;align-items:center;justify-content:space-between;max-width:800px;margin:0 auto;padding:16px 24px">
      <a href="/" style="font-weight:700;color:var(--fg);text-decoration:none">${name}</a>
      <theme-toggle></theme-toggle>
    </header>
    <main style="max-width:800px;margin:0 auto;padding:24px">
      \${children}
    </main>
  \`;
}
`);

  await writeFile(join(appDir, 'app', 'page.ts'), `import { html } from 'webjs';

export const metadata = {
  title: '${name} — built with webjs',
};

export default function Home() {
  return html\`
    <h1>Welcome to ${name}</h1>
    <p>Edit <code>app/page.ts</code> to get started.</p>
    <p>Run <code>npx webjs test</code> to run tests.</p>
    <p>Run <code>npx webjs check</code> to validate conventions.</p>
  \`;
}
`);

  // --- AGENTS.md (copy from framework root) ---

  const agentsSrc = resolve(__dirname, '..', '..', '..', 'AGENTS.md');
  if (existsSync(agentsSrc)) {
    await cp(agentsSrc, join(appDir, 'AGENTS.md'));
  }

  // --- Theme toggle component ---

  await writeFile(join(appDir, 'components', 'theme-toggle.ts'), `import { WebComponent, html, css } from 'webjs';

type Theme = 'light' | 'dark';

export class ThemeToggle extends WebComponent {
  static tag = 'theme-toggle';
  declare state: { theme: Theme };
  static styles = css\`
    :host { display: inline-flex; }
    button {
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--bg-elev);
      color: var(--fg-muted);
      cursor: pointer;
      font: 12px/1 var(--font-mono);
    }
  \`;

  constructor() {
    super();
    this.state = { theme: 'system' };
  }

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem('webjs_theme'); } catch {}
    this.setState({ theme: saved === 'light' || saved === 'dark' ? saved : 'system' });
  }

  cycle() {
    const next: Theme = this.state.theme === 'system' ? 'light'
      : this.state.theme === 'light' ? 'dark' : 'system';
    this.setState({ theme: next });
    try {
      if (next === 'system') localStorage.removeItem('webjs_theme');
      else localStorage.setItem('webjs_theme', next);
    } catch {}
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  render() {
    return html\`
      <button @click=\${() => this.cycle()}>
        \${this.state.theme === 'light' ? 'Light' : 'Dark'}
      </button>
    \`;
  }
}

ThemeToggle.register(import.meta.url);
`);

  // --- Git init + configure hooks directory ---
  const { execSync } = await import('node:child_process');
  try {
    execSync('git init', { cwd: appDir, stdio: 'pipe' });
    // Tell git to use .hooks/ as the hooks directory (tracked in the repo)
    execSync('git config core.hooksPath .hooks', { cwd: appDir, stdio: 'pipe' });
  } catch { /* git not available — skip */ }

  // --- Print success ---

  console.log(`  ${name}/
    app/layout.ts, page.ts
    components/theme-toggle.ts
    modules/
    test/unit/example.test.ts
    test/browser/example.test.js
    web-test-runner.config.js
    CONVENTIONS.md, AGENTS.md, CLAUDE.md
    package.json, tsconfig.json, .editorconfig
    .claude/settings.json, .claude/hooks/   ← Claude Code guardrails
    .cursorrules                            ← Cursor AI guardrails
    .windsurfrules                          ← Windsurf AI guardrails
    .github/copilot-instructions.md         ← GitHub Copilot guardrails
    .github/pull_request_template.md        ← PR template
`);
  console.log(`Next steps:
  cd ${name}
  npm install
  npx webjs dev

AI-driven development (enforced for all AI agents):
  ✓ Tests auto-generated with every feature
  ✓ Docs auto-updated with every change
  ✓ Git merges/pushes to main require approval
  ✓ Commits are automatic, small, and meaningful
  ✓ No AI attribution in commit messages
  ✓ Convention validation via \`npx webjs check\`
`);
}
