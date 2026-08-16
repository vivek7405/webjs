// Co-located browser test for the stream demo, in real Chromium with real SSR
// and hydration. The runner UI is `tdd` (suite/test) and there is no assertion
// library, so a tiny inline assert does the job.
//
// This pins the one thing the row fragment has to get right: the SEEDED rows
// (rendered from the html`` shape) and the STREAMED rows (rendered from the
// string shape) come off one class list, so a mutation cannot leave the list
// styled two ways. Both shapes are exercised through the real component.
import { html } from '@webjsdev/core';
import { ssrFixture } from '@webjsdev/core/testing';
import '../stream-demo.ts';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const rows = (el) => [...el.querySelectorAll('#stream-list > li')];
const button = (el, label) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const tick = () => new Promise((r) => setTimeout(r, 0));

suite('<stream-demo>', () => {
  test('SSRs the two seeded rows as direct list children', async () => {
    const el = await ssrFixture(html`<stream-demo></stream-demo>`);
    const ids = rows(el).map((li) => li.id);
    assert(ids.join(',') === 'row-1,row-2', `seeded ids, got ${ids}`);
    // A direct child, no wrapper element between the list and the row. That is
    // the structural reason the row is a fragment and not a display-only element.
    assert(rows(el).every((li) => li.parentElement.id === 'stream-list'), 'rows are direct children of the list');
  });

  test('a streamed row carries the same classes as a seeded row', async () => {
    const el = await ssrFixture(html`<stream-demo></stream-demo>`);
    const seeded = rows(el)[0].className;
    button(el, 'Append').click();
    await tick();
    const all = rows(el);
    assert(all.length === 3, `three rows after append, got ${all.length}`);
    const streamed = all[2];
    assert(streamed.id === 'row-3', `appended row is row-3, got ${streamed.id}`);
    assert(streamed.className === seeded, `streamed row classes match seeded:\n  ${streamed.className}\n  ${seeded}`);
  });

  test('replace keeps the id and reset restores the seed list', async () => {
    const el = await ssrFixture(html`<stream-demo></stream-demo>`);
    button(el, 'Replace Row 1').click();
    await tick();
    assert(rows(el)[0].id === 'row-1', 'replace keeps row-1');
    assert(rows(el)[0].textContent.includes('replaced'), 'replace swaps the content');
    button(el, 'Prepend').click();
    await tick();
    button(el, 'Reset').click();
    await tick();
    const ids = rows(el).map((li) => li.id);
    assert(ids.join(',') === 'row-1,row-2', `reset restores the seed list, got ${ids}`);
    assert(rows(el)[0].textContent.trim() === 'Row 1', 'reset restores the seed content');
  });
});
