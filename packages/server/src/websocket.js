import { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
import { matchApi } from './router.js';

/**
 * WebSocket support.
 *
 * A `route.js` file that exports a `WS` function becomes a WebSocket endpoint
 * at that URL. Example:
 *
 *   // app/api/chat/route.js
 *   const clients = new Set();
 *   export function WS(ws, req, { params }) {
 *     clients.add(ws);
 *     ws.on('message', (data) => {
 *       for (const c of clients) if (c.readyState === 1) c.send(data.toString());
 *     });
 *     ws.on('close', () => clients.delete(ws));
 *   }
 *
 * The second arg is the original `Request` (so you can read cookies, headers,
 * query params, session). The third is the usual `{ params }` shape from
 * dynamic route segments.
 *
 * Protocol choices:
 *   - HTTP/1.1 Upgrade only in v1. WebSockets-over-HTTP/2 (RFC 8441) has
 *     patchy server/browser support; h1.1 upgrade is the universal path
 *     and works alongside an h2-TLS server for page loads.
 *   - Uses the `ws` library (node's built-in WebSocketServer is not yet a
 *     stable API; `ws` is the standard and zero-dep itself).
 *
 * @param {import('node:http').Server | import('node:http2').Http2SecureServer} server
 * @param {() => import('./router.js').RouteTable} getRouteTable
 * @param {{ dev: boolean, logger: import('./logger.js').Logger }} opts
 */
export function attachWebSocket(server, getRouteTable, opts) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const table = getRouteTable();
      const match = matchApi(table, url.pathname);

      if (!match) {
        return reject(socket, 404, 'Not Found');
      }

      const mod = await loadModule(match.route.file, opts.dev);
      if (typeof mod.WS !== 'function') {
        return reject(socket, 426, 'Upgrade not supported at this route');
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          const webReq = buildRequestFromUpgrade(req, url);
          mod.WS(ws, webReq, { params: match.params });
        } catch (e) {
          opts.logger.error('WebSocket handler threw', {
            err: e instanceof Error ? e.stack || e.message : String(e),
          });
          try { ws.close(1011, 'Internal error'); } catch {}
        }
      });
    } catch (e) {
      opts.logger.error('WebSocket upgrade failed', {
        err: e instanceof Error ? e.stack || e.message : String(e),
      });
      try { reject(socket, 500, 'Upgrade failed'); } catch {}
    }
  });

  return wss;
}

/**
 * Write an HTTP error on the raw TCP socket and destroy it — used to refuse
 * an upgrade cleanly.
 * @param {import('node:net').Socket} socket
 * @param {number} status
 * @param {string} message
 */
function reject(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n` +
    `Content-Type: text/plain\r\n` +
    `Content-Length: ${Buffer.byteLength(message)}\r\n` +
    `Connection: close\r\n\r\n` +
    message
  );
  socket.destroy();
}

/**
 * Best-effort `Request` for the upgrade attempt: headers + method + URL.
 * No body (it's a WS handshake). Handy for reading cookies/auth in the handler.
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 */
function buildRequestFromUpgrade(req, url) {
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith(':')) continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
  return new Request(url, { method: 'GET', headers });
}

/**
 * @param {string} file
 * @param {boolean} dev
 */
async function loadModule(file, dev) {
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return import(url + bust);
}
