/**
 * `webjs generate <type> <name>` — code generators following CONVENTIONS.md.
 *
 * Generates files with sensible defaults matching the module architecture:
 *   webjs generate page contact           → app/contact/page.ts
 *   webjs generate module posts           → modules/posts/{actions,queries,components,utils,types.ts}
 *   webjs generate action posts/create    → modules/posts/actions/create.server.ts
 *   webjs generate query posts/list       → modules/posts/queries/list.server.ts
 *   webjs generate component my-widget    → components/my-widget.ts
 *   webjs generate route api/webhooks     → app/api/webhooks/route.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const USAGE = `Usage: webjs generate <type> <name>

Types:
  page <path>              app/<path>/page.ts
  module <name>            modules/<name>/{actions,queries,components,utils,types.ts}
  action <module/name>     modules/<module>/actions/<name>.server.ts
  query <module/name>      modules/<module>/queries/<name>.server.ts
  component <tag-name>     components/<tag-name>.ts
  route <path>             app/<path>/route.ts

Examples:
  webjs generate page contact
  webjs generate module posts
  webjs generate action posts/create
  webjs generate query posts/list
  webjs generate component my-widget
  webjs generate route api/webhooks`;

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export async function generate(args, cwd) {
  const [type, name] = args;
  if (!type || !name) { console.error(USAGE); process.exit(1); }

  switch (type) {
    case 'page': return genPage(name, cwd);
    case 'module': return genModule(name, cwd);
    case 'action': return genAction(name, cwd);
    case 'query': return genQuery(name, cwd);
    case 'component': return genComponent(name, cwd);
    case 'route': return genRoute(name, cwd);
    default:
      console.error(`Unknown type: ${type}\n${USAGE}`);
      process.exit(1);
  }
}

async function write(file, content) {
  await mkdir(dirname(file), { recursive: true });
  if (existsSync(file)) {
    console.error(`  ✗ ${file} already exists — skipping`);
    return;
  }
  await writeFile(file, content);
  console.log(`  ✓ ${file}`);
}

function toPascal(s) {
  return s.replace(/(^|[-_/])(\w)/g, (_, __, c) => c.toUpperCase());
}

function toCamel(s) {
  const p = toPascal(s);
  return p[0].toLowerCase() + p.slice(1);
}

async function genPage(path, cwd) {
  const file = join(cwd, 'app', path, 'page.ts');
  const name = toPascal(path.split('/').pop() || path);
  console.log(`Generating page: /${path}`);
  await write(file, `import { html } from 'webjs';

export const metadata = { title: '${name}' };

export default function ${name}Page() {
  return html\`
    <h1>${name}</h1>
    <p>Edit <code>app/${path}/page.ts</code></p>
  \`;
}
`);
}

async function genModule(name, cwd) {
  const base = join(cwd, 'modules', name);
  console.log(`Generating module: ${name}`);
  await mkdir(join(base, 'actions'), { recursive: true });
  await mkdir(join(base, 'queries'), { recursive: true });
  await mkdir(join(base, 'components'), { recursive: true });
  await mkdir(join(base, 'utils'), { recursive: true });

  await write(join(base, 'types.ts'), `/**
 * Shared types for the ${name} module.
 */

export interface ActionResult<T> {
  success: true; data: T;
} | {
  success: false; error: string; status: number;
}
`);

  console.log(`  ✓ modules/${name}/actions/`);
  console.log(`  ✓ modules/${name}/queries/`);
  console.log(`  ✓ modules/${name}/components/`);
  console.log(`  ✓ modules/${name}/utils/`);
}

async function genAction(path, cwd) {
  const parts = path.split('/');
  if (parts.length < 2) {
    console.error('Usage: webjs generate action <module>/<name>\n  e.g. webjs generate action posts/create');
    process.exit(1);
  }
  const mod = parts[0];
  const name = parts.slice(1).join('-');
  const fnName = toCamel(name);
  const file = join(cwd, 'modules', mod, 'actions', `${name}.server.ts`);
  console.log(`Generating action: ${mod}/${name}`);
  await write(file, `'use server';

// import { prisma } from '../../../lib/prisma.ts';

export async function ${fnName}(input: unknown) {
  // TODO: implement
  return { success: true, data: null };
}
`);
}

async function genQuery(path, cwd) {
  const parts = path.split('/');
  if (parts.length < 2) {
    console.error('Usage: webjs generate query <module>/<name>\n  e.g. webjs generate query posts/list');
    process.exit(1);
  }
  const mod = parts[0];
  const name = parts.slice(1).join('-');
  const fnName = toCamel(name);
  const file = join(cwd, 'modules', mod, 'queries', `${name}.server.ts`);
  console.log(`Generating query: ${mod}/${name}`);
  await write(file, `'use server';

// import { prisma } from '../../../lib/prisma.ts';

export async function ${fnName}() {
  // TODO: implement
  return [];
}
`);
}

async function genComponent(tagName, cwd) {
  if (!tagName.includes('-')) {
    console.error(`Component tag name must contain a hyphen: ${tagName}`);
    process.exit(1);
  }
  const className = toPascal(tagName);
  const file = join(cwd, 'components', `${tagName}.ts`);
  console.log(`Generating component: <${tagName}>`);
  await write(file, `import { WebComponent, html, css } from 'webjs';

export class ${className} extends WebComponent {
  static tag = '${tagName}';
  static styles = css\`
    :host { display: block; }
  \`;

  render() {
    return html\`<p>${tagName} works</p>\`;
  }
}
${className}.register(import.meta.url);
`);
}

async function genRoute(path, cwd) {
  const file = join(cwd, 'app', path, 'route.ts');
  console.log(`Generating route: /${path}`);
  await write(file, `/**
 * ${path} route handler.
 *
 * Convention: routes are thin wrappers over typed server actions.
 * Business logic lives in modules/, not here.
 */

export async function GET(req: Request) {
  return Response.json({ status: 'ok' });
}

export async function POST(req: Request) {
  const body = await req.json();
  // import { myAction } from '.../.server.ts';
  // return Response.json(await myAction(body));
  return Response.json({ received: body });
}
`);
}
