/**
 * The two starting shapes a `<code-block>` can be mounted from, shared by the
 * browser tests that mount them and the SSR test that proves the served one is
 * still what the server actually emits.
 *
 * It lives here rather than inside the browser test because a hand-copied
 * duplicate of server output needs a drift guard, and the guard has to run
 * where `renderToString` is available, which is node and not the browser. One
 * definition imported by both is what lets that guard exist at all.
 */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The code strings the browser suite mounts. They live here so the SSR drift
 * guard pins the SAME inputs rather than easier ones: the suite's samples
 * carry apostrophes, double quotes, and newlines, and a guard that compares
 * only `const x = 1;` would never notice the renderer changing how it treats
 * any of those in projected text.
 */
export const BROWSER_SAMPLES = {
  multiline: "const greeting = 'hi';\n// a comment\nexport function run() {}",
  angleBrackets: 'const el = <my-tag attr="1">;',
};

/**
 * The bytes `renderToString` emits for a `<code-block>`, for the shapes the
 * browser suite mounts: plain children, `label`, and `pre-class`, all as
 * STATIC attributes. It is not a general reimplementation of the renderer. An
 * attribute bound through a template hole escapes differently (core
 * double-escapes an `&` there), so do not reach for this to model one.
 *
 * The markers matter more than they look. `@webjsdev/core` selects its
 * light-DOM adoption branch on the `webjs-hydrate` marker comment, and its
 * slot adoption on `data-webjs-light` AND `data-projection` together. A
 * fixture missing any of them falls through to the client-first-mount path,
 * so the browser suite would exercise the branch NO production page takes
 * while appearing to cover the one all 480 of them do.
 *
 * `website/test/ssr/code-block-ssr.test.ts` asserts this is byte-identical to
 * real server output, so it cannot drift silently.
 */
export function ssrMarkup(code, attrs = '') {
  const label = attrs.match(/label="([^"]*)"/)?.[1];
  const preClass = attrs.match(/pre-class="([^"]*)"/)?.[1] ?? '';
  const named = label ? ` role="region" aria-label="${label}"` : '';
  return `<code-block${attrs} data-wj-host><!--webjs-hydrate--><pre class="${preClass}" tabindex="0"${named}>`
    + `<code><slot data-webjs-light data-projection="actual" data-wj-slot-owner="code-block">${esc(code)}</slot></code></pre></code-block>`;
}

/** The shape a template authors: the code as plain text children. */
export function authoredMarkup(code, attrs = '') {
  return `<code-block${attrs}>${esc(code)}</code-block>`;
}
