import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TaskStatus, Task } from '../packages/core/src/task.js';

// ---------------------------------------------------------------------------
// Helpers — mock host
// ---------------------------------------------------------------------------

function createMockHost() {
  const controllers = [];
  let updateCount = 0;

  return {
    requestUpdate() { updateCount++; },
    addController(c) { controllers.push(c); },
    get controllers() { return controllers; },
    get updateCount() { return updateCount; },
  };
}

// ---------------------------------------------------------------------------
// TaskStatus
// ---------------------------------------------------------------------------

test('TaskStatus: has correct enum values', () => {
  assert.equal(TaskStatus.INITIAL, 0);
  assert.equal(TaskStatus.PENDING, 1);
  assert.equal(TaskStatus.COMPLETE, 2);
  assert.equal(TaskStatus.ERROR, 3);
});

// ---------------------------------------------------------------------------
// Task — lifecycle
// ---------------------------------------------------------------------------

test('Task: starts in INITIAL state', () => {
  const host = createMockHost();
  const task = new Task(host, { task: async () => {} });

  assert.equal(task.status, TaskStatus.INITIAL);
  assert.equal(task.value, undefined);
  assert.equal(task.error, undefined);
});

test('Task: run() transitions to PENDING then COMPLETE', async () => {
  const host = createMockHost();
  const statuses = [];

  const task = new Task(host, {
    task: async () => {
      statuses.push(task.status);
      return 'done';
    },
    autoRun: false,
  });

  await task.run();

  assert.deepEqual(statuses, [TaskStatus.PENDING]);
  assert.equal(task.status, TaskStatus.COMPLETE);
  assert.equal(task.value, 'done');
  assert.equal(task.error, undefined);
});

test('Task: error in task transitions to ERROR', async () => {
  const host = createMockHost();
  const boom = new Error('boom');

  const task = new Task(host, {
    task: async () => { throw boom; },
    autoRun: false,
  });

  await task.run();

  assert.equal(task.status, TaskStatus.ERROR);
  assert.equal(task.error, boom);
  assert.equal(task.value, undefined);
});

test('Task: run() calls requestUpdate on host for PENDING and final state', async () => {
  const host = createMockHost();
  const task = new Task(host, {
    task: async () => 'ok',
    autoRun: false,
  });

  const before = host.updateCount;
  await task.run();

  // Expect at least 2 updates: one for PENDING, one for COMPLETE.
  assert.ok(host.updateCount - before >= 2, `expected >=2 updates, got ${host.updateCount - before}`);
});

test('Task: passes args to task function', async () => {
  const host = createMockHost();
  let receivedArgs;

  const task = new Task(host, {
    task: async (a, b, { signal }) => { receivedArgs = [a, b]; return a + b; },
    args: () => [3, 7],
    autoRun: false,
  });

  await task.run();

  assert.deepEqual(receivedArgs, [3, 7]);
  assert.equal(task.value, 10);
});

// ---------------------------------------------------------------------------
// Task.render()
// ---------------------------------------------------------------------------

test('Task.render: calls initial handler when INITIAL', () => {
  const host = createMockHost();
  const task = new Task(host, { task: async () => {}, autoRun: false });

  const result = task.render({
    initial: () => 'init',
    pending: () => 'pend',
    complete: () => 'done',
    error: () => 'err',
  });
  assert.equal(result, 'init');
});

test('Task.render: calls pending handler when PENDING', async () => {
  const host = createMockHost();
  let resolve;
  const blocker = new Promise((r) => { resolve = r; });

  const task = new Task(host, {
    task: async () => { await blocker; return 'ok'; },
    autoRun: false,
  });

  const runPromise = task.run();

  // While the task is pending:
  const result = task.render({
    initial: () => 'init',
    pending: () => 'loading',
    complete: (v) => `done:${v}`,
    error: (e) => `err:${e}`,
  });
  assert.equal(result, 'loading');

  resolve();
  await runPromise;
});

test('Task.render: calls complete handler with value when COMPLETE', async () => {
  const host = createMockHost();
  const task = new Task(host, {
    task: async () => 'payload',
    autoRun: false,
  });

  await task.run();

  const result = task.render({
    complete: (v) => `got:${v}`,
  });
  assert.equal(result, 'got:payload');
});

test('Task.render: calls error handler when ERROR', async () => {
  const host = createMockHost();
  const task = new Task(host, {
    task: async () => { throw new Error('oops'); },
    autoRun: false,
  });

  await task.run();

  const result = task.render({
    error: (e) => `err:${e.message}`,
  });
  assert.equal(result, 'err:oops');
});

test('Task.render: returns undefined for omitted handlers', () => {
  const host = createMockHost();
  const task = new Task(host, { task: async () => {}, autoRun: false });

  assert.equal(task.render({}), undefined);
  assert.equal(task.render(), undefined);
});

// ---------------------------------------------------------------------------
// Task.abort()
// ---------------------------------------------------------------------------

test('Task.abort: aborts the signal of the in-flight task', async () => {
  const host = createMockHost();
  let capturedSignal;
  let resolve;
  const blocker = new Promise((r) => { resolve = r; });

  const task = new Task(host, {
    task: async ({ signal }) => {
      capturedSignal = signal;
      await blocker;
      return 'ok';
    },
    autoRun: false,
  });

  const runPromise = task.run();

  assert.equal(capturedSignal.aborted, false);
  task.abort();
  assert.equal(capturedSignal.aborted, true);

  resolve();
  await runPromise;
});

test('Task: onUnmount aborts in-flight task', async () => {
  const host = createMockHost();
  let capturedSignal;
  let resolve;
  const blocker = new Promise((r) => { resolve = r; });

  const task = new Task(host, {
    task: async ({ signal }) => {
      capturedSignal = signal;
      await blocker;
    },
    autoRun: false,
  });

  const runPromise = task.run();

  task.onUnmount();
  assert.equal(capturedSignal.aborted, true);

  resolve();
  await runPromise;
});

// ---------------------------------------------------------------------------
// Auto-run
// ---------------------------------------------------------------------------

test('Task: auto-run triggers when args change on beforeRender', async () => {
  const host = createMockHost();
  let currentQuery = 'foo';
  let runCount = 0;

  const task = new Task(host, {
    task: async (q) => { runCount++; return `result:${q}`; },
    args: () => [currentQuery],
    autoRun: true,
  });

  // First beforeRender — prevArgs is null so it always runs.
  task.beforeRender();
  // run() is async, give it a tick to settle.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runCount, 1);

  // Same args — should not re-run.
  task.beforeRender();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runCount, 1);

  // Changed args — should re-run.
  currentQuery = 'bar';
  task.beforeRender();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runCount, 2);

  assert.equal(task.status, TaskStatus.COMPLETE);
  assert.equal(task.value, 'result:bar');
});

test('Task: autoRun false does not run on beforeRender', () => {
  const host = createMockHost();
  let runCount = 0;

  const task = new Task(host, {
    task: async () => { runCount++; },
    args: () => ['a'],
    autoRun: false,
  });

  task.beforeRender();
  assert.equal(runCount, 0);
});

// ---------------------------------------------------------------------------
// Controller registration
// ---------------------------------------------------------------------------

test('Task: registers itself via addController', () => {
  const host = createMockHost();
  const task = new Task(host, { task: async () => {} });

  assert.ok(host.controllers.includes(task));
});
