/**
 * SaaS template files for `webjs create --template saas`.
 * Extracted to avoid nested template literal escaping issues.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {string} appDir
 */
export async function writeSaasFiles(appDir) {
  // lib/prisma.ts
  await mkdir(join(appDir, 'lib'), { recursive: true });
  await writeFile(join(appDir, 'lib', 'prisma.ts'), [
    "import { PrismaClient } from '@prisma/client';",
    "",
    "const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };",
    "export const prisma = globalForPrisma.prisma || new PrismaClient();",
    "if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;",
    "",
  ].join('\n'));

  // lib/password.ts
  await writeFile(join(appDir, 'lib', 'password.ts'), [
    "import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';",
    "import { promisify } from 'node:util';",
    "",
    "const scryptAsync = promisify(scrypt);",
    "",
    "export async function hash(password: string): Promise<string> {",
    "  const salt = randomBytes(16).toString('hex');",
    "  const buf = (await scryptAsync(password, salt, 64)) as Buffer;",
    "  return salt + ':' + buf.toString('hex');",
    "}",
    "",
    "export async function compare(password: string, stored: string): Promise<boolean> {",
    "  const [salt, key] = stored.split(':');",
    "  const buf = (await scryptAsync(password, salt, 64)) as Buffer;",
    "  return timingSafeEqual(buf, Buffer.from(key, 'hex'));",
    "}",
    "",
  ].join('\n'));

  // lib/auth.ts
  await writeFile(join(appDir, 'lib', 'auth.ts'), [
    "import { createAuth, Credentials } from '@webjs/server';",
    "import { prisma } from './prisma.ts';",
    "import { compare } from './password.ts';",
    "",
    "export const { auth, signIn, signOut, handlers } = createAuth({",
    "  providers: [",
    "    Credentials({",
    "      async authorize(credentials: { email: string; password: string }) {",
    "        const user = await prisma.user.findUnique({ where: { email: credentials.email } });",
    "        if (!user || !await compare(credentials.password, user.passwordHash)) return null;",
    "        return { id: String(user.id), name: user.name, email: user.email };",
    "      },",
    "    }),",
    "  ],",
    "  secret: process.env.AUTH_SECRET,",
    "});",
    "",
  ].join('\n'));

  // prisma/schema.prisma
  await mkdir(join(appDir, 'prisma'), { recursive: true });
  await writeFile(join(appDir, 'prisma', 'schema.prisma'), [
    'datasource db {',
    '  provider = "sqlite"',
    '  url      = env("DATABASE_URL")',
    '}',
    '',
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'model User {',
    '  id           Int      @id @default(autoincrement())',
    '  email        String   @unique',
    '  name         String?',
    '  passwordHash String',
    '  createdAt    DateTime @default(now())',
    '}',
    '',
  ].join('\n'));

  // modules/auth/actions/signup.server.ts
  await mkdir(join(appDir, 'modules', 'auth', 'actions'), { recursive: true });
  await mkdir(join(appDir, 'modules', 'auth', 'queries'), { recursive: true });

  await writeFile(join(appDir, 'modules', 'auth', 'actions', 'signup.server.ts'), [
    "'use server';",
    "",
    "import { prisma } from '../../../lib/prisma.ts';",
    "import { hash } from '../../../lib/password.ts';",
    "",
    "export async function signup(input: { name: string; email: string; password: string }) {",
    "  const exists = await prisma.user.findUnique({ where: { email: input.email } });",
    "  if (exists) return { success: false as const, error: 'Email already registered', status: 409 };",
    "  const user = await prisma.user.create({",
    "    data: { name: input.name, email: input.email, passwordHash: await hash(input.password) },",
    "  });",
    "  return { success: true as const, data: { id: user.id, name: user.name, email: user.email } };",
    "}",
    "",
  ].join('\n'));

  // modules/auth/queries/current-user.server.ts
  await writeFile(join(appDir, 'modules', 'auth', 'queries', 'current-user.server.ts'), [
    "'use server';",
    "",
    "import { auth } from '../../../lib/auth.ts';",
    "",
    "export async function currentUser() {",
    "  const session = await auth();",
    "  return session?.user ?? null;",
    "}",
    "",
  ].join('\n'));

  // modules/auth/types.ts
  await writeFile(join(appDir, 'modules', 'auth', 'types.ts'), [
    "export interface User {",
    "  id: number;",
    "  name: string | null;",
    "  email: string;",
    "}",
    "",
    "export type ActionResult<T> =",
    "  | { success: true; data: T }",
    "  | { success: false; error: string; status: number };",
    "",
  ].join('\n'));

  // app/api/auth/[...path]/route.ts
  await mkdir(join(appDir, 'app', 'api', 'auth', '[...path]'), { recursive: true });
  await writeFile(join(appDir, 'app', 'api', 'auth', '[...path]', 'route.ts'), [
    "import { handlers } from '../../../../../lib/auth.ts';",
    "export const GET = handlers.GET;",
    "export const POST = handlers.POST;",
    "",
  ].join('\n'));

  // app/login/page.ts
  await mkdir(join(appDir, 'app', 'login'), { recursive: true });
  await writeFile(join(appDir, 'app', 'login', 'page.ts'), [
    "import { html } from 'webjs';",
    "",
    "export const metadata = { title: 'Login' };",
    "",
    "export default function LoginPage() {",
    "  return html`",
    "    <h1>Login</h1>",
    "    <form method=\"POST\" action=\"/api/auth/callback/credentials\">",
    "      <label>Email <input type=\"email\" name=\"email\" required></label>",
    "      <label>Password <input type=\"password\" name=\"password\" required></label>",
    "      <button type=\"submit\">Sign in</button>",
    "    </form>",
    "    <p>Don't have an account? <a href=\"/signup\">Sign up</a></p>",
    "  `;",
    "}",
    "",
  ].join('\n'));

  // app/signup/page.ts
  await mkdir(join(appDir, 'app', 'signup'), { recursive: true });
  await writeFile(join(appDir, 'app', 'signup', 'page.ts'), [
    "import { html } from 'webjs';",
    "",
    "export const metadata = { title: 'Sign up' };",
    "",
    "export default function SignupPage() {",
    "  return html`",
    "    <h1>Sign up</h1>",
    "    <form id=\"signup-form\">",
    "      <label>Name <input type=\"text\" name=\"name\" required></label>",
    "      <label>Email <input type=\"email\" name=\"email\" required></label>",
    "      <label>Password <input type=\"password\" name=\"password\" required minlength=\"8\"></label>",
    "      <button type=\"submit\">Create account</button>",
    "    </form>",
    "    <p>Already have an account? <a href=\"/login\">Log in</a></p>",
    "  `;",
    "}",
    "",
  ].join('\n'));

  // app/dashboard/middleware.ts
  await mkdir(join(appDir, 'app', 'dashboard', 'settings'), { recursive: true });
  await writeFile(join(appDir, 'app', 'dashboard', 'middleware.ts'), [
    "import { auth } from '../../lib/auth.ts';",
    "",
    "export default async function requireAuth(req: Request, next: () => Promise<Response>) {",
    "  const session = await auth();",
    "  if (!session?.user) {",
    "    return new Response(null, { status: 302, headers: { location: '/login' } });",
    "  }",
    "  return next();",
    "}",
    "",
  ].join('\n'));

  // app/dashboard/page.ts
  await writeFile(join(appDir, 'app', 'dashboard', 'page.ts'), [
    "import { html } from 'webjs';",
    "import { currentUser } from '../../modules/auth/queries/current-user.server.ts';",
    "",
    "export const metadata = { title: 'Dashboard' };",
    "",
    "export default async function Dashboard() {",
    "  const user = await currentUser();",
    "  return html`",
    "    <h1>Dashboard</h1>",
    "    <p>Welcome, ${`\\$\\{user?.name || user?.email\\}`}!</p>",
    "    <a href=\"/dashboard/settings\">Settings</a>",
    "  `;",
    "}",
    "",
  ].join('\n'));

  // app/dashboard/settings/page.ts
  await writeFile(join(appDir, 'app', 'dashboard', 'settings', 'page.ts'), [
    "import { html } from 'webjs';",
    "import { currentUser } from '../../../modules/auth/queries/current-user.server.ts';",
    "",
    "export const metadata = { title: 'Settings' };",
    "",
    "export default async function Settings() {",
    "  const user = await currentUser();",
    "  return html`",
    "    <h1>Settings</h1>",
    "    <p>Email: ${`\\$\\{user?.email\\}`}</p>",
    "    <p>Name: ${`\\$\\{user?.name || 'Not set'\\}`}</p>",
    "  `;",
    "}",
    "",
  ].join('\n'));
}
