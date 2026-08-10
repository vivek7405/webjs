// Example node test for booting the app in-process (from @webjsdev/server).
// startServer({ appDir, port }) boots the whole app and resolves to
// { server, close } (the same entry `webjs start` uses; port 0 picks a free
// port, so a test never collides). Close it in a finally so the port is
// released. This is the realistic way to smoke-test that the app boots and
// listens; for asserting on responses without a socket, use the handle()
// harness (see modules/server-actions/actions/greet.test.ts and the docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '@webjsdev/server';

const appDir = process.cwd();

test('startServer boots the app in-process on an ephemeral port', async () => {
  const { server, close } = await startServer({ appDir, dev: true, port: 0 });
  try {
    assert.ok(server.address(), 'the server is listening');
  } finally {
    await close();
  }
});
