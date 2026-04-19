import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRouteTable } from '../packages/server/src/router.js';
import { attachWebSocket } from '../packages/server/src/websocket.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

async function scaffold(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-ws-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, body);
  }
  // Link to @webjs/core so route files can import it if needed.
  const scopeDir = join(dir, 'node_modules', '@webjs');
  await mkdir(scopeDir, { recursive: true });
  const realWebjs = new URL('../packages/core', import.meta.url).pathname;
  await symlink(realWebjs, join(scopeDir, 'core'), 'dir').catch(() => {});
  return dir;
}

async function startTestServer(dir) {
  const table = await buildRouteTable(dir);
  const server = createServer((_req, res) => res.end());
  attachWebSocket(server, () => table, { dev: false, logger: silentLogger });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  return { server, port, close: () => new Promise((r) => server.close(() => r())) };
}

test('route.js WS export is invoked on upgrade with req + params', async () => {
  const dir = await scaffold({
    'app/api/echo/[id]/route.js': `
      export function WS(ws, req, { params }) {
        ws.send(JSON.stringify({ helloId: params.id, origin: req.headers.get('host') }));
        ws.on('message', (data) => ws.send('echo:' + data.toString()));
      }
    `,
  });
  try {
    const { port, close } = await startTestServer(dir);
    try {
      const ws = new WebSocket(`ws://localhost:${port}/api/echo/42`);
      const messages = [];
      await new Promise((resolve, reject) => {
        ws.on('message', (d) => {
          messages.push(d.toString());
          if (messages.length === 1) ws.send('hi');
          else if (messages.length === 2) resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('ws timeout')), 2000);
      });
      ws.close();
      assert.match(messages[0], /"helloId":"42"/);
      assert.equal(messages[1], 'echo:hi');
    } finally { await close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('404 upgrade refused cleanly for unmatched path', async () => {
  const dir = await scaffold({
    'app/api/ok/route.js': `export function WS(ws) { ws.close(); }`,
  });
  try {
    const { port, close } = await startTestServer(dir);
    try {
      const ws = new WebSocket(`ws://localhost:${port}/nope`);
      const err = await new Promise((resolve) => {
        ws.on('error', resolve);
        ws.on('open', () => resolve(new Error('unexpected open')));
      });
      assert.ok(/Unexpected server response: 404/.test(String(err)));
    } finally { await close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('426 when route.js exists but has no WS export', async () => {
  const dir = await scaffold({
    'app/api/noup/route.js': `export const GET = () => new Response('ok');`,
  });
  try {
    const { port, close } = await startTestServer(dir);
    try {
      const ws = new WebSocket(`ws://localhost:${port}/api/noup`);
      const err = await new Promise((resolve) => {
        ws.on('error', resolve);
        ws.on('open', () => resolve(new Error('unexpected open')));
      });
      assert.ok(/Unexpected server response: 426/.test(String(err)));
    } finally { await close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
