// app/global-error.ts is the ROOT-ONLY, app-wide catch-all error boundary. It
// fires only after every nested error.ts boundary is exhausted, which includes
// a failure in the root layout itself. Because a root-layout failure is exactly
// when it runs, it renders its OWN complete document (<!doctype><html><body>),
// returned verbatim with NO framework <head> splice, so it ships no importmap
// and no boot script. Keep it static HTML with no components or hydration: a
// last-resort page must not depend on the module system that may have just
// failed. (Under an opt-in CSP, an inline <script> here needs a nonce via
// cspNonce() from @webjsdev/server. An inline <style> only needs one if you
// tighten style-src, since the default policy allows inline style outright.)
//
// Distinct from error.ts (a nested, per-segment boundary that renders a body
// fragment the framework wraps) and from global-not-found.ts (the unmatched-URL
// 404). In production only error.message is exposed, never the stack.
import { html, cspNonce } from '@webjsdev/core';

export default function GlobalError({ error }: { error: Error }) {
  const message = process.env.NODE_ENV === 'production'
    ? 'Something went wrong. Please try again.'
    : error?.message || 'Unknown error';
  // cspNonce() is '' with CSP off (the default), so this is safe as-is. Under the
  // default opt-in policy the inline <style> is allowed by 'unsafe-inline' rather
  // than by this nonce, which is stamped so the page still works if you tighten
  // style-src to a nonce source.
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong</title>
        <style nonce="${cspNonce()}">
          body { font: 16px/1.6 system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #1e2226; color: #dee2e6; }
          main { max-width: 32rem; padding: 2rem; text-align: center; }
          a { color: #94989c; }
        </style>
      </head>
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>${message}</p>
          <p><a href="/">Back to home</a></p>
        </main>
      </body>
    </html>`;
}
