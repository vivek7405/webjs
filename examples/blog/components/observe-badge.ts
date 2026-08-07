/**
 * A shipping side-effect module that observes the observed-badge element's
 * registration. This is the cross-module observation the #169 fix detects:
 * because a graph-reachable module waits for the tag to upgrade, the
 * analyser forces observed-badge to ship instead of eliding it. Without
 * the observation the badge would be elided like the build-stamp element.
 *
 * The returned promise is intentionally unused. The call is SSR-safe: the
 * server's customElements shim returns a promise that simply never resolves
 * there, so no browser-only API is touched during SSR.
 *
 * The doc prose here avoids angle-bracket tag syntax, which is a habit from
 * before #179: comments are masked before every signal scan now, so prose
 * naming a tag registers as nothing and the discipline is no longer load
 * bearing. The real observation is the executable line below.
 */
void customElements.whenDefined('observed-badge');
