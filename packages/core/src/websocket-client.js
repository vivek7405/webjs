/**
 * Tiny client-side WebSocket helper with automatic reconnection, JSON
 * parse/stringify, and the webjs CSRF-style matches-origin wss:// scheme
 * rewriting.
 *
 * ```js
 * import { connectWS } from '@webjskit/core';
 *
 * const conn = connectWS('/api/chat', {
 *   onMessage: (msg) => this.setState({ lines: [...this.state.lines, msg] }),
 *   onOpen: () => this.setState({ connected: true }),
 *   onClose: () => this.setState({ connected: false }),
 * });
 *
 * conn.send({ type: 'say', text: 'hi' });
 * conn.close();
 * ```
 *
 * Relative paths (`/api/chat`) are promoted to `ws://` or `wss://` based on
 * `location.protocol`. Absolute `ws(s)://` URLs pass through unchanged.
 *
 * Reconnect: exponential backoff 1s, 2s, 4s, …, capped at 30s. Every
 * successful open resets the counter. Call `.close()` to stop retrying.
 *
 * Messages are parsed as JSON when possible and passed raw (String) when not.
 * Outgoing `send(data)` stringifies objects to JSON; strings and
 * ArrayBuffer/Uint8Array are sent verbatim.
 *
 * @typedef {{
 *   onOpen?: (ev: Event) => void,
 *   onMessage?: (data: any, ev: MessageEvent) => void,
 *   onClose?: (ev: CloseEvent) => void,
 *   onError?: (ev: Event) => void,
 *   protocols?: string | string[],
 *   reconnect?: boolean,
 * }} ConnectOptions
 *
 * @param {string} url
 * @param {ConnectOptions} [opts]
 */
export function connectWS(url, opts = {}) {
  const reconnect = opts.reconnect !== false;
  let retries = 0;
  let stopped = false;
  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {any[]} */
  const queue = [];

  function connect() {
    if (stopped) return;
    ws = new WebSocket(absoluteUrl(url), opts.protocols);
    ws.onopen = (ev) => {
      retries = 0;
      // Flush anything queued while disconnected.
      while (queue.length && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(/** @type any */ (queue.shift()));
      }
      opts.onOpen?.(ev);
    };
    ws.onmessage = (ev) => {
      let data = ev.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { /* leave as string */ }
      }
      opts.onMessage?.(data, ev);
    };
    ws.onerror = (ev) => {
      opts.onError?.(ev);
    };
    ws.onclose = (ev) => {
      opts.onClose?.(ev);
      if (!stopped && reconnect) {
        const delay = Math.min(1000 * 2 ** retries++, 30_000);
        setTimeout(connect, delay);
      }
    };
  }

  connect();

  return {
    /** Send a message. Objects are JSON-stringified; strings and binary pass through.
     *  If the socket isn't open yet, the message is queued until it is. */
    send(data) {
      const payload =
        typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data)
          ? data
          : JSON.stringify(data);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(/** @type any */ (payload));
      else queue.push(payload);
    },
    /** Permanently close the socket. Disables reconnect. */
    close(code, reason) {
      stopped = true;
      try { ws?.close(code, reason); } catch {}
    },
    /** Access the underlying socket (may be null while reconnecting). */
    get socket() { return ws; },
    /** Current ready state (0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED). */
    get readyState() { return ws?.readyState ?? 3; },
  };
}

/** @param {string} url */
function absoluteUrl(url) {
  if (/^wss?:\/\//i.test(url)) return url;
  const scheme = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof location !== 'undefined' ? location.host : '';
  return `${scheme}//${host}${url.startsWith('/') ? url : '/' + url}`;
}
