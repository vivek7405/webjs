/**
 * Counterfactual fixture for `scripts/eval-design.mjs` (#1116).
 *
 * Every one of the nine rubric lines is tripped exactly once here, on purpose,
 * so the test can assert each line INDIVIDUALLY. A fixture that tripped only
 * some of them would let a silently dead line hide behind a failing sibling,
 * which is the failure mode a counterfactual exists to catch.
 *
 * Do not "fix" anything in this file. Its defects are the assertions.
 */
import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';

interface Delivery {
  id: string;
  route: string;
  total: number;
}

const deliveries: Delivery[] = [];

export default function DirtyDashboard() {
  return html`
    <!-- line 1 raw-palette-utilities, line 3 arbitrary-spacing, line 6 semantic-elevation -->
    <section class="bg-red-500 p-[13px] shadow-md">
      <!-- line 5 heading-hierarchy: two h1 elements in one page -->
      <h1 class="text-[15px]">Deliveries</h1>
      <h1>Also deliveries</h1>

      <!-- line 2 literal-colour-values -->
      <p style="color: #3b82f6">Everything is fine.</p>

      <!-- line 9 label-value-antipattern -->
      <p>Total: ${deliveries.length}</p>

      <!-- line 7 empty-state-present: a list with no empty branch -->
      <ul>
        ${deliveries.map((d) => html`<li>${d.route}</li>`)}
      </ul>

      <!-- line 8 action-pyramid: two default-variant buttons -->
      <button class=${buttonClass()}>Save</button>
      <button class=${buttonClass()}>Export</button>
    </section>
  `;
}
