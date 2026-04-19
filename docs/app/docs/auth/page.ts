import { html } from '@webjs/core';

export const metadata = { title: 'Authentication — webjs' };

export default function Auth() {
  return html`
    <h1>Authentication</h1>
    <p>webjs provides NextAuth-style authentication with OAuth providers, credentials login, and JWT sessions. No external auth library needed.</p>

    <h2>Setup</h2>
    <pre>// lib/auth.ts — create once
import { createAuth, Credentials, Google, GitHub } from '@webjs/server';
import { prisma } from './prisma.ts';

export const { auth, signIn, signOut, handlers } = createAuth({
  providers: [
    Credentials({
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        });
        if (!user || !verifyPassword(credentials.password, user.passwordHash)) {
          return null;
        }
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
    Google(),  // reads AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET from env
    GitHub(),  // reads AUTH_GITHUB_ID, AUTH_GITHUB_SECRET from env
  ],
  secret: process.env.AUTH_SECRET,
});</pre>

    <h2>Mount the auth API route</h2>
    <pre>// app/api/auth/[...path]/route.ts
import { handlers } from '../../../../lib/auth.ts';
export const GET = handlers.GET;
export const POST = handlers.POST;</pre>

    <h2>Read the session</h2>
    <pre>// In any page or server action:
import { auth } from '../lib/auth.ts';

export default async function Dashboard() {
  const session = await auth();
  if (!session) throw redirect('/login');
  return html\`&lt;h1&gt;Welcome, \${session.user.name}&lt;/h1&gt;\`;
}</pre>

    <h2>Sign in and sign out</h2>
    <pre>// Server actions
import { signIn, signOut } from '../lib/auth.ts';

export async function login(credentials) {
  return signIn('credentials', credentials);
}

export async function loginWithGoogle() {
  return signIn('google', {}, { redirectTo: '/dashboard' });
}

export async function logout() {
  return signOut({ redirectTo: '/' });
}</pre>

    <h2>Callbacks</h2>
    <p>Customize the session and JWT with callbacks:</p>
    <pre>createAuth({
  // ...providers
  callbacks: {
    async jwt({ token, user }) {
      // Add custom fields to the JWT
      if (user) {
        token.sub = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose custom fields to auth()
      session.user.id = token.sub;
      session.user.role = token.role;
      return session;
    },
  },
});</pre>

    <h2>Providers</h2>
    <table>
      <thead><tr><th>Provider</th><th>Env vars</th><th>Flow</th></tr></thead>
      <tbody>
        <tr><td><code>Credentials()</code></td><td>None</td><td>Custom authorize function — you handle password verification</td></tr>
        <tr><td><code>Google()</code></td><td><code>AUTH_GOOGLE_ID</code>, <code>AUTH_GOOGLE_SECRET</code></td><td>OAuth 2.0 redirect flow</td></tr>
        <tr><td><code>GitHub()</code></td><td><code>AUTH_GITHUB_ID</code>, <code>AUTH_GITHUB_SECRET</code></td><td>OAuth 2.0 redirect flow</td></tr>
      </tbody>
    </table>

    <h2>Session strategies</h2>
    <p><strong>JWT (default):</strong> Session data signed in a cookie. Stateless — scales horizontally without Redis. Cannot be revoked before expiry.</p>
    <p><strong>Database:</strong> Session ID in cookie, data in cache store. Can revoke sessions instantly. Requires Redis or similar for horizontal scaling.</p>
    <pre>createAuth({
  session: { strategy: 'database' },  // default: 'jwt'
  // ...
});</pre>

    <h2>Environment variables</h2>
    <pre>AUTH_SECRET=your-random-secret-32-chars-minimum
AUTH_GOOGLE_ID=your-google-oauth-client-id
AUTH_GOOGLE_SECRET=your-google-oauth-client-secret
AUTH_GITHUB_ID=your-github-oauth-client-id
AUTH_GITHUB_SECRET=your-github-oauth-client-secret</pre>
    <p>Generate a secret: <code>node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code></p>
  `;
}
