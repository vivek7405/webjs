import { html } from '@webjsdev/core';

/**
 * An inert page: no component of its own, so it is a plain server-rendered
 * module and an edit to it classifies as `page`. `PAGE_A` is the marker the
 * test rewrites, and the tall div is what makes scroll observable.
 */
export default function Home() {
  return html`
    <h1 id="page-marker">PAGE_A</h1>
    <div style="height:3000px"></div>
  `;
}
