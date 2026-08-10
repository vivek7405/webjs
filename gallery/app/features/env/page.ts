// Environment variables: process.env.X reads are server-only. NODE_ENV is
// defined on both sides. A name prefixed WEBJS_PUBLIC_ is exposed to the browser
// through an inline script (no build step); everything else stays server-side
// so secrets never reach the client. This page reads them during SSR, so the
// values are in the first paint with no JS. Validate required vars at boot with
// an app-root env.ts (a schema or a validator fn) that fails fast.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export const metadata: Metadata = { title: 'Env vars (public vs server) | features' };

export default function EnvExample() {
  // Server-only read (this function runs on the server for SSR).
  const nodeEnv = process.env.NODE_ENV || 'development';
  // A WEBJS_PUBLIC_ var is safe to surface to the browser; unset here unless you
  // add WEBJS_PUBLIC_APP_NAME=... to .env, which demonstrates the default.
  const publicName = process.env.WEBJS_PUBLIC_APP_NAME || '(unset, add WEBJS_PUBLIC_APP_NAME to .env)';
  return html`
    ${pageHeading('Environment variables')}
    ${lede(html`
      Read on the server during SSR. Only <code>WEBJS_PUBLIC_</code>-prefixed
      names are exposed to the browser; the rest stay server-side.
    `)}
    <ul class="list-disc pl-5 mb-4 space-y-1">
      <li><code class="font-mono text-sm">NODE_ENV</code> = <span class="text-primary">${nodeEnv}</span> <span class="text-muted-foreground text-sm">(defined both sides)</span></li>
      <li><code class="font-mono text-sm">WEBJS_PUBLIC_APP_NAME</code> = <span class="text-primary">${publicName}</span></li>
    </ul>
    <p class="text-muted-foreground text-sm">
      Never read a secret in a page, layout, or component that ships to the
      browser. Keep secret reads in <code class="font-mono">.server.ts</code>
      files, and validate required vars at boot with
      <code class="font-mono">app/env.ts</code>.
    </p>
  `;
}
