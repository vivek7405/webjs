import { html } from '@webjsdev/core';

export const metadata = { title: 'Authentication | WebJs' };

export default function Auth() {
  return html`
    <h1>Authentication</h1>
    <p>WebJs provides NextAuth-style authentication with OAuth providers, credentials login, and JWT sessions. No external auth library needed.</p>

    <h2>Setup</h2>
    <pre>// lib/auth.server.ts: create once
import { createAuth, Credentials, Google, GitHub } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';

export const { auth, signIn, signOut, handlers } = createAuth({
  providers: [
    Credentials({
      async authorize(credentials) {
        const user = await db.query.users.findFirst({
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
import { handlers } from '#lib/auth.server.ts';
export const GET = handlers.GET;
export const POST = handlers.POST;</pre>

    <h2>Read the session</h2>
    <pre>// In any page or server action:
import { auth } from '#lib/auth.server.ts';

export default async function Dashboard() {
  const session = await auth();
  if (!session) throw redirect('/login');
  return html\`&lt;h1&gt;Welcome, \${session.user.name}&lt;/h1&gt;\`;
}</pre>
    <p>A <code>redirect()</code> thrown during a GET page render (an auth gate like this) defaults to <code>302 Found</code>, the conventional bounce code. The same <code>redirect()</code> thrown from a server action (a POST) defaults to the method-preserving <code>307</code> instead; an explicit <code>redirect(url, status)</code> overrides either. To type <code>session.user</code> so <code>session.user.name</code> needs no cast, see <a href="/docs/typescript">Typing the auth() Session User</a>.</p>

    <h2>Sign in and sign out</h2>
    <pre>// Server actions
import { signIn, signOut } from '#lib/auth.server.ts';

export async function login(credentials) {
  return signIn('credentials', credentials);
}

export async function loginWithGoogle() {
  return signIn('google', {}, { redirectTo: '/dashboard' });
}

export async function logout() {
  return signOut({ redirectTo: '/' });
}</pre>
    <p><code>signOut</code> is also reachable as a route: the mounted <code>handlers</code> serve <code>POST /api/auth/signout</code>, so a plain <code>&lt;form method="POST" action="/api/auth/signout"&gt;</code> logs a user out with no JavaScript. That is how the scaffold's auth gallery card renders its logout button.</p>

    <h2>Showing a failed sign-in</h2>
    <p>A failed credentials sign-in redirects to <code>&#36;{pages.error}?error=CredentialsSignin</code>, falling back to the home page when <code>pages.error</code> is unset (which silently swallows the failure). Point the error page at your login route, then read the code and render a message:</p>
    <pre>createAuth({
  // ...providers, secret
  pages: { error: '/login' },  // a failed sign-in returns here
});

// app/login/page.ts
export default function LoginPage({ searchParams }) {
  const failed = searchParams.error === 'CredentialsSignin';
  return html\`
    &#36;{failed ? html\`&lt;p role="alert"&gt;Invalid email or password.&lt;/p&gt;\` : ''}
    &lt;form method="POST" action="/api/auth/signin/credentials"&gt;...&lt;/form&gt;
  \`;
}</pre>
    <p>The scaffold's auth gallery card wires exactly this, so a wrong password shows a message on the login page instead of bouncing to the landing page with no feedback.</p>

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

    <h2>Type the session</h2>
    <p>By default <code>auth()</code> resolves <code>{ user: Record&lt;string, unknown&gt; }</code>, so reading a custom field your callbacks set (like <code>session.user.id</code>) needs a cast and a typo slips past TypeScript. Opt into a typed <code>user</code> one of two ways.</p>

    <p><strong>Augment <code>AuthUser</code></strong> (NextAuth/Auth.js style) to type every <code>auth()</code> call across the app. Declare the fields your <code>session</code>/<code>jwt</code> callbacks set:</p>
    <pre>// lib/auth.server.ts (or any .d.ts in the project)
declare module '@webjsdev/server' {
  interface AuthUser {
    id: string;
    role: 'admin' | 'member';
  }
}</pre>
    <p>Now <code>session.user.id</code> is <code>string</code> everywhere, and a misspelling like <code>session.user.idd</code> is a compile error.</p>

    <p><strong>Or parameterise the factory</strong> with <code>createAuth&lt;TUser&gt;()</code> to type just this instance, without a global augmentation:</p>
    <pre>interface AppUser {
  id: string;
  role: 'admin' | 'member';
}

export const { auth, signIn, signOut, handlers } =
  createAuth&lt;AppUser&gt;({ /* ...providers, secret */ });

const session = await auth();
session?.user.role; // typed as 'admin' | 'member', no cast</pre>
    <p>Both are types-only and opt-in: leave them out and <code>auth().user</code> stays the loose <code>Record&lt;string, unknown&gt;</code>, so existing code keeps working unchanged. The fields you declare should match what your callbacks actually write onto <code>session.user</code>.</p>

    <h2>Providers</h2>
    <table>
      <thead><tr><th>Provider</th><th>Env vars</th><th>Flow</th></tr></thead>
      <tbody>
        <tr><td><code>Credentials()</code></td><td>None</td><td>Custom authorize function, you handle password verification</td></tr>
        <tr><td><code>Google()</code></td><td><code>AUTH_GOOGLE_ID</code>, <code>AUTH_GOOGLE_SECRET</code></td><td>OAuth 2.0 redirect flow</td></tr>
        <tr><td><code>GitHub()</code></td><td><code>AUTH_GITHUB_ID</code>, <code>AUTH_GITHUB_SECRET</code></td><td>OAuth 2.0 redirect flow</td></tr>
      </tbody>
    </table>

    <h2>Session strategies</h2>
    <p><strong>JWT (default):</strong> Session data signed in a cookie. Stateless and scales horizontally without Redis. Cannot be revoked before expiry.</p>
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
