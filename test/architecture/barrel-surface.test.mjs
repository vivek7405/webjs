import { test } from 'node:test';
import assert from 'node:assert/strict';

const BARREL_FLOORS = [
  { path: '../../packages/core/src/router-client.js', floor: 70 },
  { path: '../../packages/core/src/slot.js', floor: 31 },
  { path: '../../packages/server/src/vendor.js', floor: 26 },
  { path: '../../packages/server/src/ssr.js', floor: 21 },
  { path: '../../packages/server/src/dev.js', floor: 16 },
  { path: '../../packages/cli/lib/doctor.js', floor: 11 },
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

test('every floor equals its barrel\'s current export count', async () => {
  // A floor set BELOW the real count tolerates losing exactly that many
  // exports, which is the regression the guard exists to catch. router-client
  // drifted to 68 against 69 when a merge added `refreshPage`, and the gap was
  // invisible because the floor assertion still passed.
  //
  // So adding an export is a deliberate act: it fails here until the floor is
  // raised with it.
  for (const { path, floor } of BARREL_FLOORS) {
    const mod = await import(path);
    const count = Object.keys(mod).filter((k) => k !== 'default').length;
    assert.equal(
      count, floor,
      `${path} exports ${count} but its floor is ${floor}; raise the floor with the export`,
    );
  }
});
