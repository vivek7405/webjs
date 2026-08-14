/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * Advisory (#646): name why a page/layout SHIPS its module to the browser
 * instead of being elided. A page/layout that is a pure carrier (import-only
 * #605 / inert #179) stays out of the browser; one that ships whole is pinned
 * by a specific client-effecting NON-component on a component-free path from it, #963 (a util touching
 * a client global, a module-scope side effect, a bare side-effect import) or by
 * its own client work. This turns that invisible #605/#179 regression into a
 * named line. WARN only: a page legitimately MAY ship, and the analyser is
 * biased toward shipping by design (server AGENTS invariant 7), so this is a
 * "you may not have intended this" hint, never a hard fail.
 * @param {Promise<any|null>} elisionPromise  the ONE shared report (#1308)
 * @returns {Promise<DoctorResult>}
 */
export async function checkElisionCarriers(elisionPromise) {
  const name = 'Page/layout elision (carrier hygiene)';
  const report = await elisionPromise;
  if (!report) {
    // Analysis unavailable (no app, malformed, server import failed): no advice.
    return { name, status: 'pass', message: 'not analysed (no routable app or analysis unavailable)' };
  }
  if (!report.analysed) {
    return { name, status: 'pass', message: 'not analysed (no routable app, or elision is disabled)' };
  }
  // Paths and reasons arrive app-relative from `analyzeAppElision` (#1308).
  const shipped = report.routeModules.filter((r) => r.verdict === 'shipped');
  if (shipped.length === 0) {
    return { name, status: 'pass', message: 'every page/layout is elided (a pure import-only or inert carrier)' };
  }
  // Name the FIRST client-effecting blocker (there may be more than one; the
  // module stays shipped until every such blocker is moved out).
  const lines = shipped.map(({ file, blocker, reason }) =>
    blocker
      ? `${file} ships whole. Its first client-effecting blocker is ${blocker}, which ${reason} and is not a component`
      : `${file} ships whole because it ${reason}`,
  );
  return {
    name,
    status: 'warn',
    message:
      `${shipped.length} page/layout module(s) ship to the browser instead of being elided:\n` +
      lines.map((l) => `    ${l}`).join('\n'),
    fix: 'Move the client work out of the page/layout closure (into a component, or a .server module reached through an action) so the carrier can be elided, or accept that it ships. See references/components.md in the skill.',
  };
}

/**
 * The OTHER direction of the elision verdict (#1308): which COMPONENT modules
 * the browser never downloads. `checkElisionCarriers` above reports the benign
 * over-ship direction; this one reports what was DROPPED, which is where a
 * wrong verdict silently costs an app its interactivity.
 *
 * Pass-only except for orphans, deliberately. An elided component is the
 * DESIRED outcome, so warning on one would fire on every healthy app and train
 * the reader to skip doctor output. The passing message carries the elided
 * inventory instead, which makes it the discovery surface, while `webjs
 * elision` is the detail surface. The one always-wrong condition is an ORPHAN:
 * a `class X extends WebComponent` with no literal-tag registration is
 * invisible to the scanner, so it gets no verdict at all and `static
 * interactive = true` cannot rescue it (nothing consults the component
 * analyser for a component the scanner never saw). Never `fail`:
 * an app that wants an orphan to break CI gates `ELISION_COMPONENTS` to
 * `error` via `webjs.doctor.gate`.
 *
 * @param {Promise<any|null>} elisionPromise  the ONE shared report
 * @returns {Promise<DoctorResult>}
 */
export async function checkElisionComponents(elisionPromise) {
  const name = 'Component elision (what the browser drops)';
  const report = await elisionPromise;
  const notAnalysed = { name, status: /** @type {const} */ ('pass'), message: 'not analysed (no routable app or analysis unavailable)' };
  if (!report) return notAnalysed;
  if (!report.analysed) {
    return report.skipped === 'elide-off'
      ? { name, status: 'pass', message: 'elision is disabled (webjs.elide false or WEBJS_ELIDE), so every component module ships' }
      : notAnalysed;
  }
  if (report.orphans.length > 0) {
    const lines = report.orphans.map(({ file, className }) =>
      `${className} in ${file} is never registered with a literal tag`,
    );
    return {
      name,
      status: 'warn',
      message:
        `${report.orphans.length} component class(es) get NO elision verdict:\n` +
        lines.map((l) => `    ${l}`).join('\n') +
        '\n    Either it has no registration call at all, or it registers a computed tag. The component '
        + 'scanner matches only a literal tag, so either way it never sees the class: no elision verdict, no '
        + 'registry entry, no preload hint, and `static interactive = true` cannot rescue it. With no '
        + 'registration call the element never upgrades at all; with a computed tag it upgrades only while '
        + 'its module still reaches the browser through an importer that ships.',
      fix: 'Register it with a literal tag, Class.register(\'my-tag\') (invariant 3 already requires one), or delete the class if nothing uses it.',
    };
  }
  const elided = report.components.filter((c) => c.verdict === 'elided');
  const tags = elided.flatMap((c) => c.tags);
  const shown = tags.slice(0, 8).join(', ');
  const tail = tags.length > 8 ? `, +${tags.length - 8} more` : '';
  return {
    name,
    status: 'pass',
    message:
      `${report.summary.elided} of ${report.summary.components} component module(s) are elided (never downloaded)` +
      (tags.length ? `: ${shown}${tail}` : '') +
      '. Run `webjs elision` for the full verdict.',
  };
}
