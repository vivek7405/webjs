/**
 * Real-browser assertions for the mid-commit-throw recovery.
 *
 * `repeat()` reconciliation is DOM-identity-sensitive (it MOVES existing
 * nodes rather than rebuilding them), so linkedom alone is not enough to
 * prove the region recovers: the corruption is an orphaned node that no map
 * entry points at, and node identity is the thing that shows it.
 *
 * The throw comes from a value whose `toString` throws, which is what any
 * attribute commit does to its value, so nothing here depends on the
 * form-action guard.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { repeat } from '../../../src/repeat.js';

import { assert } from '../../../../../test/browser-assert.js';

/** A value that throws when a commit stringifies it. */
const poison = { toString() { throw new Error('boom'); } };

suite('directive commit throws (browser)', () => {
  let container;

  setup(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  teardown(() => {
    container.remove();
  });

  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li><span title=${it.title ?? ''}>${it.label}</span></li>`,
  )}</ul>`;

  const good = [
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
    { id: 3, label: 'three' },
  ];

  const labels = () => [...container.querySelectorAll('li')].map((li) => li.textContent);

  test('a mid-walk throw leaves no orphaned row behind', () => {
    render(rows(good), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);

    assert.throws(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);

    // A fully valid render. Key 1 used to be dropped from the map while its
    // <li> stayed in the document, so a second "one" was built and the
    // orphan was never removed.
    render(rows(good), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);
    assert.equal(container.querySelectorAll('li').length, 3);

    // Byte-identical on the next render rather than settling into a
    // permanently wrong list.
    render(rows(good), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);
    assert.equal(container.querySelectorAll('li').length, 3);
  });

  test('every row after recovery is tracked, so a reorder moves it', () => {
    render(rows(good), container);
    assert.throws(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);
    render(rows(good), container);

    // Node identity is what proves the rebuilt rows are genuinely owned by
    // the new map: a keyed reorder MOVES the existing element. An orphan
    // left over from the throw is tracked by nothing, so it would neither
    // move nor be removed here.
    const before = [...container.querySelectorAll('li')];
    render(rows([good[2], good[0], good[1]]), container);
    const after = [...container.querySelectorAll('li')];

    assert.deepEqual(after.map((li) => li.textContent), ['three', 'one', 'two']);
    assert.strictEqual(after[0], before[2]);
    assert.strictEqual(after[1], before[0]);
    assert.strictEqual(after[2], before[1]);
  });

  test('removing rows after recovery leaves nothing behind', () => {
    render(rows(good), container);
    assert.throws(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);
    render(rows(good), container);

    render(rows([]), container);
    assert.equal(container.querySelectorAll('li').length, 0);
  });
});
