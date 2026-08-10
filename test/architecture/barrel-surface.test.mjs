import { test } from 'node:test';
import assert from 'node:assert/strict';

const BARREL_FLOORS = [
  { path: '../../packages/core/src/router-client.js', floor: 68 },
  { path: '../../packages/core/src/slot.js', floor: 31 },
  { path: '../../packages/server/src/vendor.js', floor: 25 },
  { path: '../../packages/server/src/ssr.js', floor: 18 },
  { path: '../../packages/server/src/dev.js', floor: 16 },
  { path: '../../packages/cli/lib/doctor.js', floor: 9 },
  { path: '../../packages/core/src/render-server.js', floor: 2 },
  { path: '../../packages/core/src/component.js', floor: 2 },
  { path: '../../packages/server/src/check.js', floor: 2 },
  { path: '../../packages/core/src/render-client.js', floor: 1 },
];

for (const { path, floor } of BARREL_FLOORS) {
  test(`barrel surface floor for ${path}`, async () => {
    const mod = await import(path);
    const count = Object.keys(mod).filter((k) => k !== 'default').length;
    assert.ok(
      count >= floor,
      `Expected ${path} to export at least ${floor} named exports, got ${count}`
    );
  });
}
