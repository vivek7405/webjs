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
export async function scaffoldApp(name, cwd, opts = {}) {
  const template = opts.template || 'full-stack';
  const isApi = template === 'api';
  const isSaas = template === 'saas';
  const appDir = join(cwd, name);
  if (existsSync(appDir)) {
    console.error(`Error: directory '${name}' already exists.`);
    process.exit(1);
  }

  console.log(`\nwebjs create: scaffolding '${name}' (${template})...\n`);

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
      '@webjskit/cli': 'latest',
      '@webjskit/core': 'latest',
      '@webjskit/server': 'latest',
      ...(isSaas ? { '@prisma/client': '^6.0.0' } : {}),
    },
    devDependencies: {
      esbuild: '^0.28.0',
      '@web/test-runner': '^0.20.0',
      '@web/test-runner-playwright': '^0.11.0',
      'playwright': '^1.59.0',
      ...(isSaas ? { prisma: '^6.0.0' } : {}),
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
      // ts-lit-plugin gives tag/attribute intelligence inside html`` templates
      // (autocomplete, type-check, go-to-definition for <my-element>).
      // Install: `npm i -D ts-lit-plugin`. Remove this plugin entry if you don't want it.
      plugins: [{ name: 'ts-lit-plugin', strict: true }],
    },
  }, null, 2) + '\n');

  // --- Templates (AGENTS.md, CONVENTIONS.md, CLAUDE.md, test files, Claude hooks) ---

  const templateFiles = [
    'AGENTS.md',
    'CONVENTIONS.md',
    'CLAUDE.md',
    'test/unit/example.test.ts',
    'test/browser/example.test.js',
    'web-test-runner.config.js',
    // Environment variables
    '.env.example',
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

  // --- App files (template-specific) ---

  if (isApi) {
    // API-only template: no layout, no page, no components.
    // Just a health route and an example module with route wrapper.
    await mkdir(join(appDir, 'app', 'api', 'health'), { recursive: true });
    await mkdir(join(appDir, 'app', 'api', 'users'), { recursive: true });
    await writeFile(join(appDir, 'app', 'api', 'health', 'route.ts'), `export async function GET() {
  return Response.json({ status: 'ok', timestamp: Date.now() });
}
`);
    await mkdir(join(appDir, 'modules', 'users', 'actions'), { recursive: true });
    await mkdir(join(appDir, 'modules', 'users', 'queries'), { recursive: true });

    await writeFile(join(appDir, 'modules', 'users', 'queries', 'list-users.server.ts'), `'use server';

export async function listUsers() {
  // TODO: replace with real data source
  return [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];
}
`);
    await writeFile(join(appDir, 'modules', 'users', 'actions', 'create-user.server.ts'), `'use server';

export async function createUser(input: { name: string; email: string }) {
  // TODO: validate input, persist to database
  return { success: true, data: { id: Date.now().toString(), ...input } };
}
`);
    await writeFile(join(appDir, 'app', 'api', 'users', 'route.ts'), `/**
 * /api/users — thin route wrapper over typed server actions.
 * Business logic lives in modules/users/, not here.
 */
import { listUsers } from '../../../../modules/users/queries/list-users.server.ts';
import { createUser } from '../../../../modules/users/actions/create-user.server.ts';

export async function GET() {
  return Response.json(await listUsers());
}

export async function POST(req: Request) {
  const body = await req.json();
  return Response.json(await createUser(body));
}
`);
    await writeFile(join(appDir, 'modules', 'users', 'types.ts'), `export interface User {
  id: string;
  name: string;
  email: string;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };
`);
  }

  if (!isApi) {
    // Full-stack and SaaS templates: layout + page + theme toggle + Tailwind

    // Copy the Tailwind browser runtime + _utils/ui.ts helpers from the
    // scaffold templates directory so the app boots with the exact blog
    // example architecture: light DOM + Tailwind + JS helpers.
    const publicDir = join(appDir, 'public');
    await mkdir(publicDir, { recursive: true });
    const tailwindSrc = join(TEMPLATES, 'public', 'tailwind-browser.js');
    if (existsSync(tailwindSrc)) {
      await cp(tailwindSrc, join(publicDir, 'tailwind-browser.js'));
    }

    const utilsDir = join(appDir, 'app', '_utils');
    await mkdir(utilsDir, { recursive: true });
    const uiSrc = join(TEMPLATES, 'app', '_utils', 'ui.ts');
    if (existsSync(uiSrc)) {
      await cp(uiSrc, join(utilsDir, 'ui.ts'));
    }

  await writeFile(join(appDir, 'app', 'layout.ts'), `import { html } from '@webjskit/core';
import '@webjskit/core/client-router';
import '../components/theme-toggle.ts';

/**
 * Root layout — globals + chrome.
 *
 * Light DOM + Tailwind by default. Design tokens live in :root and are
 * mapped into the Tailwind palette via @theme, so classes like
 * text-fg, bg-bg-elev, font-serif, duration-fast, text-display all work.
 *
 * Nav + footer links repeat the same class bundle, so they're extracted
 * into small JS helpers below. Each helper runs at SSR time inside
 * html\\\`\\\`, producing static HTML in the response — no client runtime.
 */

const navLink = (href: string, label: string) => html\`
  <a href=\${href} class="text-fg-muted no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-fast hover:text-fg">\${label}</a>
\`;

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
    <script src="/public/tailwind-browser.js"></script>
    <style type="text/tailwindcss">
      @theme {
        --color-fg:            var(--fg);
        --color-fg-muted:      var(--fg-muted);
        --color-fg-subtle:     var(--fg-subtle);
        --color-bg:            var(--bg);
        --color-bg-elev:       var(--bg-elev);
        --color-bg-subtle:     var(--bg-subtle);
        --color-border:        var(--border);
        --color-border-strong: var(--border-strong);
        --color-accent:        var(--accent);
        --color-accent-hover:  var(--accent-hover);
        --color-accent-fg:     var(--accent-fg);
        --color-accent-tint:   var(--accent-tint);
        --font-sans:  var(--font-sans);
        --font-serif: var(--font-serif);
        --font-mono:  var(--font-mono);
        --text-display: clamp(2.6rem, 1.6rem + 3.2vw, 4.25rem);
        --text-h1:      clamp(2rem, 1.5rem + 1.6vw, 2.85rem);
        --text-h2:      clamp(1.35rem, 1.15rem + 0.7vw, 1.7rem);
        --text-lede:    clamp(1.05rem, 0.95rem + 0.3vw, 1.2rem);
        --duration-fast: 140ms;
        --duration-slow: 380ms;
      }
    </style>
    <style>
      :root {
        color-scheme: light dark;
        /* ---------- dark (default) ---------- */
        --fg:            oklch(0.96 0.015 60);
        --fg-muted:      oklch(0.72 0.02 60);
        --fg-subtle:     oklch(0.55 0.02 60);
        --bg:            oklch(0.14 0.01 55);
        --bg-elev:       oklch(0.18 0.01 55);
        --bg-subtle:     oklch(0.16 0.01 55);
        --border:        oklch(0.26 0.012 55 / 0.9);
        --border-strong: oklch(0.38 0.012 55 / 0.9);
        --accent:        oklch(0.78 0.14 55);
        --accent-hover:  oklch(0.85 0.14 55);
        --accent-fg:     oklch(0.15 0.01 55);
        --accent-tint:   oklch(0.78 0.14 55 / 0.14);
        --font-sans:   -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --font-serif:  ui-serif, 'Iowan Old Style', Palatino, Georgia, serif;
        --font-mono:   ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      :root[data-theme='light'] {
        --fg:            oklch(0.18 0.015 60);
        --fg-muted:      oklch(0.42 0.02 65);
        --fg-subtle:     oklch(0.62 0.015 70);
        --bg:            oklch(0.985 0.008 80);
        --bg-elev:       oklch(1 0 0);
        --bg-subtle:     oklch(0.96 0.008 80);
        --border:        oklch(0.88 0.01 75 / 0.95);
        --border-strong: oklch(0.78 0.01 75 / 0.95);
        --accent:        oklch(0.58 0.15 55);
        --accent-hover:  oklch(0.5 0.15 55);
        --accent-fg:     oklch(1 0 0);
        --accent-tint:   oklch(0.58 0.15 55 / 0.1);
      }
      @media (prefers-color-scheme: light) {
        :root:not([data-theme='dark']) {
          --fg:            oklch(0.18 0.015 60);
          --fg-muted:      oklch(0.42 0.02 65);
          --fg-subtle:     oklch(0.62 0.015 70);
          --bg:            oklch(0.985 0.008 80);
          --bg-elev:       oklch(1 0 0);
          --bg-subtle:     oklch(0.96 0.008 80);
          --border:        oklch(0.88 0.01 75 / 0.95);
          --border-strong: oklch(0.78 0.01 75 / 0.95);
          --accent:        oklch(0.58 0.15 55);
          --accent-hover:  oklch(0.5 0.15 55);
          --accent-fg:     oklch(1 0 0);
          --accent-tint:   oklch(0.58 0.15 55 / 0.1);
        }
      }
      /* Body + pseudo-elements utility classes can't reach. */
      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }
    </style>

    <header class="sticky top-0 z-20 flex items-center gap-6 px-4 sm:px-6 py-3 border-b border-border bg-[color-mix(in_oklch,var(--bg)_75%,transparent)] backdrop-blur-[18px]">
      <a href="/" class="mr-auto inline-flex items-center gap-2 no-underline text-fg font-semibold text-[15px] leading-none tracking-tight">
        <span>${name}</span>
      </a>
      <nav class="flex gap-4 items-center">
        \${navLink('/', 'Home')}
        <theme-toggle></theme-toggle>
      </nav>
    </header>

    <main class="block max-w-[760px] mx-auto px-4 sm:px-6 pt-[72px] pb-12 min-h-screen">
      \${children}
    </main>
  \`;
}
`);

  await writeFile(join(appDir, 'app', 'page.ts'), `import { html } from '@webjskit/core';
import { rubric, displayH1, accentLink } from './_utils/ui.ts';

export const metadata = {
  title: '${name} — built with webjs',
};

export default function Home() {
  return html\`
    <section class="mb-18">
      \${rubric('welcome')}
      \${displayH1(html\`Hello from <span class="text-accent italic">${name}</span>.\`)}
      <p class="text-lede leading-[1.5] text-fg-muted max-w-[56ch] m-0">
        Edit <code class="font-mono text-[0.9em]">app/page.ts</code> to get started.
        Run \${accentLink('#', 'npx webjs test')} to run tests and
        \${accentLink('#', 'npx webjs check')} to validate conventions.
      </p>
    </section>

    <section class="mt-18 pt-6 border-t border-border">
      <h2 class="font-serif text-[1.6rem] tracking-[-0.02em] font-bold m-0 mb-2">Light DOM + Tailwind</h2>
      <p class="text-fg-muted text-sm m-0 mb-4">
        Components render into light DOM by default. Tailwind utility classes
        apply directly. Set <code class="font-mono text-[0.9em]">static shadow = true</code>
        on a component when you need scoped styles, &lt;slot&gt; projection,
        or third-party-embed isolation.
      </p>
    </section>
  \`;
}
`);

  // AGENTS.md is copied via the `templateFiles` loop above, from
  // `packages/cli/templates/AGENTS.md` with `{{APP_NAME}}` substitution.

  // --- Theme toggle component ---

  await writeFile(join(appDir, 'components', 'theme-toggle.ts'), `import { WebComponent, html } from '@webjskit/core';

type Theme = 'system' | 'light' | 'dark';

/**
 * <theme-toggle> — light DOM component styled with Tailwind utilities.
 *
 * Light DOM is the default: no static shadow = true, no static styles.
 * Because this component has no custom CSS (only Tailwind classes,
 * which are already unique by construction), the class-prefix rule
 * doesn't apply here. If you ever add a <style> block, prefix every
 * selector with 'theme-toggle' (e.g. .theme-toggle__btn or
 * \`theme-toggle .btn\`).
 */
export class ThemeToggle extends WebComponent {
  declare state: { theme: Theme };

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
      <button
        class="inline-flex items-center px-3 py-1.5 rounded-full border border-border bg-bg-elev text-fg-muted font-mono text-[11px] leading-none tracking-wider uppercase duration-fast hover:text-fg hover:border-border-strong"
        @click=\${() => this.cycle()}
      >
        \${this.state.theme === 'system' ? 'Auto'
          : this.state.theme === 'light' ? 'Light' : 'Dark'}
      </button>
    \`;
  }
}

ThemeToggle.register('theme-toggle');
`);
  } // end if (!isApi)

  // --- SaaS template extras: auth, dashboard, prisma ---
  if (isSaas) {
    const { writeSaasFiles } = await import('./saas-template.js');
    await writeSaasFiles(appDir);
  }

  // AGENTS.md is already in place via the shared `templateFiles` loop
  // earlier in this function — no framework-root fallback needed.

  // --- Git init + configure hooks directory ---
  const { execSync } = await import('node:child_process');
  try {
    execSync('git init', { cwd: appDir, stdio: 'pipe' });
    // Tell git to use .hooks/ as the hooks directory (tracked in the repo)
    execSync('git config core.hooksPath .hooks', { cwd: appDir, stdio: 'pipe' });
  } catch { /* git not available — skip */ }

  // --- Print success ---

  if (isApi) {
    console.log(`  ${name}/
    app/api/health/route.ts
    app/api/users/route.ts               ← thin wrapper over server actions
    modules/users/{actions,queries,types.ts}
    CONVENTIONS.md, AGENTS.md, CLAUDE.md
`);
  } else if (isSaas) {
    console.log(`  ${name}/
    app/layout.ts, page.ts, login/, signup/
    app/dashboard/{page,settings,middleware}.ts  ← protected
    app/api/auth/[...path]/route.ts      ← auth API
    modules/auth/{actions,queries,types.ts}
    lib/{auth,prisma,password}.ts
    prisma/schema.prisma                 ← User model
    components/theme-toggle.ts
    CONVENTIONS.md, AGENTS.md, CLAUDE.md
`);
  } else {
    console.log(`  ${name}/
    app/layout.ts, page.ts       ← light DOM + Tailwind + @theme tokens
    app/_utils/ui.ts             ← JS helpers for repeated class bundles
    public/tailwind-browser.js   ← Tailwind runtime
    components/theme-toggle.ts   ← light DOM web component
    modules/
    CONVENTIONS.md, AGENTS.md, CLAUDE.md
`);
  }
  console.log(`Next steps:
  cd ${name}
  npm install${isSaas ? '\n  npx prisma migrate dev --name init' : ''}
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
