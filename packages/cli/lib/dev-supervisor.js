/**
 * Dev-server reload supervisor planning for `webjs dev` (issue #514).
 *
 * `webjs dev` re-execs itself under the host runtime's hot-reload supervisor so
 * an edit to a transitively-imported module (an action, query, component, util)
 * takes effect without a manual restart. Both runtimes cache ES modules by
 * resolved URL with no public invalidation API, so the dev re-import in
 * `@webjsdev/server`'s `dev.js` relies on the runtime's own file-watching cache
 * invalidation:
 *
 * - **Node** has no in-place module-cache eviction, so it re-execs under
 *   `node --watch`, which RESTARTS the process on a file change (a fresh ESM
 *   cache each time). The dev re-import additionally appends a `?t=` cache-bust
 *   query that Node honours between restarts.
 * - **Bun** keys its module cache by path and IGNORES that `?t=` query, so the
 *   `node --watch` model does not transfer: without help a re-imported module
 *   stays STALE on Bun (the #514 bug). Bun's `--hot` invalidates loaded modules
 *   on a file change WITHOUT restarting the process, which is exactly what the
 *   dev re-import needs; `Bun.serve` is reused across hot reloads, so the
 *   listener is not duplicated. `--hot` auto-watches every loaded file, so the
 *   node `--watch-path` flags do not apply (and are not Bun flags).
 *
 * This pure planner returns the spawn decision so the bin stays a thin shell and
 * the branch logic is unit-testable without spawning a process.
 */

/**
 * Plan how `webjs dev` runs its server.
 *
 * @param {object} opts
 * @param {boolean} opts.isBun  Whether the host runtime is Bun (`process.versions.bun`).
 * @param {string[]} opts.argv  `process.argv.slice(1)` (the script path followed by its args), forwarded to the child verbatim.
 * @param {boolean} opts.noHot  Whether `--no-hot` was passed (opt out of the supervisor entirely).
 * @param {(path: string) => boolean} opts.exists  Existence check for the Node `--watch-path` targets (relative to cwd). Unused on Bun.
 * @returns {{ mode: 'inline' } | { mode: 'spawn', args: string[] }}
 *   `inline` runs the server in this process (no reload watcher); `spawn`
 *   re-execs `process.execPath` with `args` and `__WEBJS_DEV_CHILD=1`.
 */
export function planDevSupervisor({ isBun, argv, noHot, exists }) {
  // `--no-hot` opts out of the reload supervisor on either runtime: run the dev
  // server in THIS process with no watcher. Degraded dev (a deep-import edit
  // needs a manual restart) but useful under an external process manager or a
  // debugger that wants a single, un-re-exec'd process.
  if (noHot) return { mode: 'inline' };

  if (isBun) return { mode: 'spawn', args: ['--hot', ...argv] };

  // Node: re-exec under `node --watch`, watching the project dirs/files that
  // exist. `--watch-preserve-output` keeps prior logs across a restart.
  const watchPaths = [];
  for (const dir of ['app', 'components', 'modules', 'lib', 'actions']) {
    if (exists(dir)) watchPaths.push('--watch-path', dir);
  }
  // Every extension the server's root-middleware lookup accepts, in the same
  // order. If these two lists diverge, an app gets a middleware that loads but
  // never restarts the dev server when edited, which is the quiet half of the
  // bug where a `middleware.ts` was loaded by neither.
  for (const f of ['middleware.ts', 'middleware.js', 'middleware.mts', 'middleware.mjs']) {
    if (exists(f)) watchPaths.push('--watch-path', f);
  }
  return {
    mode: 'spawn',
    args: ['--watch', '--watch-preserve-output', ...watchPaths, ...argv],
  };
}
