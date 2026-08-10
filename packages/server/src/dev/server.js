import { existsSync, watch as fsWatch } from 'node:fs';
import { relative, sep } from 'node:path';
import { createServer as createHttp1Server } from 'node:http';
import { createRequestHandler } from './handler.js';
import { readServerTimeoutsFromApp, readDevWatchPathsFromApp } from './config.js';
import { defaultLogger } from '../logger.js';
import { SseHub, makeShutdown, installProcessHandlers, DEV_BOOT_ID, serverRuntime } from '../listener-core.js';
import { urlFromRequest } from '../forwarded.js';
import { propagateTrustedRemoteIp } from '../rate-limit.js';
import { isRegenerateOutputPath } from '../dev-regenerate.js';
import { stripBasePath } from '../base-path.js';
import { basePath } from '../importmap.js';
import { toWebRequest, sendWebResponse } from './helpers.js';

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function shouldIgnoreWatchPath(filename) {
  return /(?:^|[\\/])(?:node_modules|\.git|\.webjs)(?:[\\/]|$)|(?:^|[\\/])db[\\/](?:dev\.db|migrations)/.test(filename || '');
}

function makeHttpServer(handler) {
  return createHttp1Server(handler);
}

function startNodeListener(ctx) {
  const { app, dev, compress, logger, hub, port, basePathStr, timeouts, watcherAbort } = ctx;

  const server = makeHttpServer(async (req, res) => {
    try {
      const url = urlFromRequest(req);

      if (stripBasePath(url.pathname, basePathStr) === '/__webjs/events') {
        if (!dev) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`retry: 300\nevent: hello\ndata: ${DEV_BOOT_ID}\n\n`);
        const client = {
          send: (s) => { try { res.write(s); } catch {} },
          close: () => { try { res.end(); } catch {} },
        };
        hub.add(client);
        const pending = app.getLastDevError?.();
        if (pending) {
          try { res.write(`event: webjs-error\ndata: ${JSON.stringify(pending)}\n\n`); } catch {}
        }
        res.socket?.on('close', () => hub.remove(client));
        return;
      }

      if (
        !dev &&
        (req.method === 'GET' || req.method === 'HEAD') &&
        typeof res.writeEarlyHints === 'function'
      ) {
        const match = app.routeFor(url.pathname);
        if (match && match.moduleUrls.length) {
          try {
            res.writeEarlyHints({
              link: match.moduleUrls.map((u) => `<${u}>; rel=modulepreload`),
            });
          } catch (e) {
            logger.warn('writeEarlyHints failed', { err: String(e) });
          }
        }
      }

      const webReq = toWebRequest(req, url);
      const resp = await app.handle(webReq);
      await sendWebResponse(res, resp, req, { compress });
    } catch (e) {
      logger.error('request pipeline threw', { err: e instanceof Error ? e.stack : String(e) });
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(dev && e instanceof Error ? `webjs error: ${e.stack}` : 'Internal server error');
    }
  });

  server.requestTimeout = timeouts.requestTimeout;
  server.headersTimeout = timeouts.headersTimeout;
  server.keepAliveTimeout = timeouts.keepAliveTimeout;

  attachWebSocket(server, () => app.getRouteTable(), { dev, logger });

  server.listen(port, () => {
    logger.info(`webjs ${dev ? 'dev' : 'prod'} server ready on http://localhost:${port}`);
    app.warmup();
  });

  const closeServer = () => new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve(undefined)));
  });
  const shutdown = makeShutdown({ closeServer, hub, logger });
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  installProcessHandlers(logger, () => shutdown('uncaughtException', { fatal: true }));

  return {
    server,
    close: () => new Promise((r) => {
      if (watcherAbort) watcherAbort.abort();
      hub.closeAll();
      server.close(() => r());
    }),
  };
}

export async function startServer(opts) {
  const dev = !!opts.dev;
  const port = opts.port ?? 8080;
  const compress = opts.compress ?? !dev;
  const logger = opts.logger || defaultLogger({ dev });

  const hub = new SseHub();
  let app;
  try {
    app = await createRequestHandler({
      ...opts,
      logger,
      onReload: () => hub.reload(),
      onDevError: (frame) => hub.devError(frame),
    });
  } catch (e) {
    hub.closeAll();
    throw e;
  }

  /** @type {AbortController | null} */
  let watcherAbort = null;
  if (dev) {
    const rebuild = debounce(() => app.rebuild(), 80);
    watcherAbort = new AbortController();
    const watchRoot = async (root) => {
      try {
        const events = fsWatch(root, { recursive: true, signal: watcherAbort.signal });
        for await (const event of events) {
          const filename = event.filename || '';
          if (shouldIgnoreWatchPath(filename)) continue;
          if (app.isRegenerateOutput(filename)) continue;
          rebuild();
        }
      } catch (err) {
        if (err && /** @type any */(err).name !== 'AbortError') {
          logger.warn({ err }, `file watcher exited (${root})`);
        }
      }
    };
    watchRoot(app.appDir);
    const extraWatch = (await readDevWatchPathsFromApp(app.appDir)).filter((p) => existsSync(p));
    for (const root of extraWatch) watchRoot(root);
    if (extraWatch.length) logger.info?.(`[webjs] also watching ${extraWatch.length} extra dev path(s): ${extraWatch.join(', ')}`);
  }

  const timeouts = await readServerTimeoutsFromApp(app.appDir);

  /** @type {import('../listener-types.js').ListenerContext} */
  const ctx = { app, dev, compress, logger, hub, port, basePathStr: basePath(), timeouts, watcherAbort };

  if (serverRuntime() === 'bun') {
    const { startBunListener } = await import('../listener-bun.js');
    return startBunListener(ctx);
  }
  return startNodeListener(ctx);
}
