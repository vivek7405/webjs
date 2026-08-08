/**
 * Precondition guard for the two suites that read real blog rows (#1323).
 *
 * `examples/blog/db/dev.db` is gitignored, so a fresh worktree has no seeded
 * posts and these suites fail on assertions about post links and search
 * results, none of which name the database. `npm run worktree:link` seeds it
 * automatically now, so this fires only when the suite ran without that step
 * (or with WEBJS_NO_WORKTREE_SEED=1), and it replaces three cryptic assertion
 * failures with one that names the remedy.
 *
 * It reads the rendered homepage rather than opening SQLite, so it stays a
 * statement about the app's observable output and holds for a blog served on
 * either runtime.
 *
 * @param {string} homeHtml the SSR'd HTML of the blog's `/`
 * @throws {Error} when the homepage lists no post
 */
export function assertBlogSeeded(homeHtml) {
  if (/<a[^>]+href=["']\/blog\/[^"']+["']/.test(homeHtml)) return;
  throw new Error(
    'The blog database has no posts, so these tests cannot pass. '
    + 'Run `npm run worktree:link` from this worktree, or run `npm run db:migrate` '
    + 'then `npm run db:seed` inside examples/blog.',
  );
}
