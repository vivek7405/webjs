import { html } from 'webjs';

export const metadata = { title: 'WebSockets — webjs' };

export default function WebSockets() {
  return html`
    <h1>WebSockets</h1>
    <p>webjs has first-class WebSocket support. Export a <code>WS</code> function from any <code>route.ts</code> file and it becomes a WebSocket endpoint at that URL. On the client, <code>connectWS()</code> provides auto-reconnect, JSON serialisation, and send queuing out of the box.</p>

    <h2>Server Side: Export WS</h2>
    <p>Add a named <code>WS</code> export to any <code>route.ts</code> file. The function receives the raw WebSocket connection, the upgrade Request, and the route params:</p>

    <pre>// app/api/echo/route.ts
import type { WebSocket } from 'ws';

export function WS(ws: WebSocket, req: Request, { params }: { params: Record&lt;string, string&gt; }) {
  console.log('New WebSocket connection');

  ws.on('message', (data) =&gt; {
    ws.send('echo: ' + data.toString());
  });

  ws.on('close', () =&gt; {
    console.log('Client disconnected');
  });
}</pre>

    <h3>The WS Function Signature</h3>
    <pre>export function WS(
  ws: WebSocket,          // ws library WebSocket instance
  req: Request,           // the HTTP upgrade Request
  ctx: { params: Record&lt;string, string&gt; }  // dynamic route params
): void</pre>

    <p>The three arguments give you everything you need:</p>
    <ul>
      <li><strong><code>ws</code></strong> -- the <a href="https://github.com/websockets/ws">ws</a> library's <code>WebSocket</code> instance. Use <code>ws.on('message', ...)</code>, <code>ws.send()</code>, <code>ws.close()</code>, and all other ws APIs.</li>
      <li><strong><code>req</code></strong> -- a standard <code>Request</code> constructed from the HTTP upgrade request. It carries the original headers, cookies, URL, and query parameters. Use it for authentication: read the session cookie, verify a JWT from the <code>Authorization</code> header, or check query params.</li>
      <li><strong><code>{ params }</code></strong> -- dynamic route segment values, just like in API route handlers. For <code>app/api/rooms/[roomId]/route.ts</code>, <code>params.roomId</code> is the room ID from the URL.</li>
    </ul>

    <h3>Under the Hood</h3>
    <p>webjs uses the <a href="https://github.com/websockets/ws">ws</a> library with <code>noServer: true</code>. When the Node.js HTTP server receives an <code>Upgrade</code> request:</p>
    <ol>
      <li>The URL is matched against the API route table.</li>
      <li>If a match is found, the route's module is loaded and checked for a <code>WS</code> export.</li>
      <li>If <code>WS</code> exists, <code>wss.handleUpgrade()</code> completes the WebSocket handshake.</li>
      <li>The <code>WS</code> function is called with the upgraded socket.</li>
      <li>If no match is found or the route does not export <code>WS</code>, the socket is rejected with an HTTP error (404 or 426) and destroyed.</li>
    </ol>
    <p>WebSocket connections use HTTP/1.1 Upgrade. Even when the server is configured for HTTP/2 (with <code>allowHTTP1: true</code>), WebSocket upgrades happen over the HTTP/1.1 fallback path, which is the universally supported approach.</p>

    <h3>Accessing Cookies, Headers, and Auth</h3>
    <p>The <code>req</code> parameter carries the full HTTP upgrade request, so you can authenticate the connection before accepting messages:</p>

    <pre>// app/api/protected-ws/route.ts
import type { WebSocket } from 'ws';

export function WS(ws: WebSocket, req: Request) {
  // Read cookies
  const cookies = parseCookies(req.headers.get('cookie') || '');
  const sessionId = cookies['session'];

  // Verify auth
  const user = sessions.get(sessionId);
  if (!user) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.on('message', (data) =&gt; {
    // user is available in the closure
    handleMessage(user, JSON.parse(data.toString()));
  });
}

function parseCookies(header: string): Record&lt;string, string&gt; {
  const out: Record&lt;string, string&gt; = {};
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq &gt; 0) out[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}</pre>

    <p>You can also read query parameters from the upgrade URL:</p>

    <pre>export function WS(ws: WebSocket, req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!verifyToken(token)) {
    ws.close(4001, 'Bad token');
    return;
  }
  // ... handle messages
}</pre>

    <h2>Client Side: connectWS()</h2>
    <p>The <code>connectWS()</code> function from <code>webjs</code> creates a managed WebSocket connection with automatic reconnection, JSON handling, and send queuing:</p>

    <pre>import { connectWS } from 'webjs';

const conn = connectWS('/api/chat', {
  onOpen: () =&gt; {
    console.log('Connected');
  },
  onMessage: (data) =&gt; {
    // data is already JSON-parsed if the server sent JSON
    console.log('Received:', data);
  },
  onClose: (ev) =&gt; {
    console.log('Disconnected:', ev.code, ev.reason);
  },
  onError: (ev) =&gt; {
    console.error('WebSocket error', ev);
  },
});

// Send a message (objects are JSON-stringified automatically)
conn.send({ type: 'say', text: 'Hello!' });

// Send a raw string
conn.send('ping');

// Later: permanently close (disables reconnect)
conn.close();</pre>

    <h3>URL Resolution</h3>
    <p>Relative paths like <code>'/api/chat'</code> are automatically promoted to the correct WebSocket URL based on the current page's protocol:</p>
    <ul>
      <li><code>http://</code> page -- <code>ws://localhost:3000/api/chat</code></li>
      <li><code>https://</code> page -- <code>wss://example.com/api/chat</code></li>
    </ul>
    <p>Absolute <code>ws://</code> or <code>wss://</code> URLs pass through unchanged.</p>

    <h3>Auto-Reconnect with Exponential Backoff</h3>
    <p>By default, <code>connectWS()</code> automatically reconnects when the connection drops. The backoff schedule is:</p>
    <ul>
      <li>1st retry: 1 second</li>
      <li>2nd retry: 2 seconds</li>
      <li>3rd retry: 4 seconds</li>
      <li>4th retry: 8 seconds</li>
      <li>...and so on, capped at <strong>30 seconds</strong></li>
    </ul>
    <p>Every successful connection resets the backoff counter to zero. To disable reconnect:</p>

    <pre>const conn = connectWS('/api/one-shot', {
  reconnect: false,
  onMessage: (data) =&gt; { /* ... */ },
});</pre>

    <p>Calling <code>conn.close()</code> permanently stops reconnection.</p>

    <h3>Automatic JSON Parse/Stringify</h3>
    <ul>
      <li><strong>Sending:</strong> if you call <code>conn.send(obj)</code> with an object, it is <code>JSON.stringify</code>'d before sending. Strings, <code>ArrayBuffer</code>, and <code>Uint8Array</code> are sent as-is.</li>
      <li><strong>Receiving:</strong> incoming text messages are parsed with <code>JSON.parse</code>. If parsing fails (the message is not valid JSON), the raw string is passed to <code>onMessage</code>.</li>
    </ul>

    <h3>Send Queuing While Disconnected</h3>
    <p>If you call <code>conn.send()</code> before the socket is open or while it is reconnecting, the message is queued in memory. When the connection (re)opens, all queued messages are flushed in order. This means you do not need to check connection state before sending -- messages are never silently dropped.</p>

    <pre>// Safe to call immediately -- message is queued if not yet connected
const conn = connectWS('/api/events');
conn.send({ type: 'subscribe', channel: 'updates' });</pre>

    <h3>Connection State</h3>
    <p>The returned connection object exposes:</p>
    <ul>
      <li><code>conn.send(data)</code> -- send a message (queued if not open)</li>
      <li><code>conn.close(code?, reason?)</code> -- permanently close and disable reconnect</li>
      <li><code>conn.socket</code> -- the underlying <code>WebSocket</code> instance (may be <code>null</code> while reconnecting)</li>
      <li><code>conn.readyState</code> -- current state: 0 (CONNECTING), 1 (OPEN), 2 (CLOSING), 3 (CLOSED)</li>
    </ul>

    <h2>The globalThis Pattern for Shared State</h2>
    <p>In dev mode, webjs cache-busts module imports on every request so that edits take effect immediately. This means module-level variables (like a <code>Set</code> of connected clients) are reset every time the module reloads. To preserve shared state across dev reloads, attach it to <code>globalThis</code>:</p>

    <pre>// modules/chat/clients.ts
import type { WebSocket } from 'ws';

declare global {
  var __webjs_chat_clients: Set&lt;WebSocket&gt; | undefined;
}

export const clients: Set&lt;WebSocket&gt; =
  globalThis.__webjs_chat_clients ??
  (globalThis.__webjs_chat_clients = new Set());

export function broadcast(msg: unknown, except?: WebSocket): void {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of clients) {
    if (c === except) continue;
    if (c.readyState === 1) {
      try { c.send(payload); } catch { /* ignore dead client */ }
    }
  }
}</pre>

    <p>This pattern works because <code>globalThis</code> persists across module re-imports within the same Node.js process. In production (no cache-busting), the module is loaded once and this pattern is a no-op.</p>

    <h2>Example: Live Chat (Broadcast)</h2>
    <p>A complete live chat implementation with server broadcast and client UI:</p>

    <h3>Server</h3>
    <pre>// modules/chat/clients.ts (shared state as above)
import type { WebSocket } from 'ws';

declare global {
  var __webjs_chat_clients: Set&lt;WebSocket&gt; | undefined;
}

export const clients: Set&lt;WebSocket&gt; =
  globalThis.__webjs_chat_clients ??
  (globalThis.__webjs_chat_clients = new Set());

export function broadcast(msg: unknown, except?: WebSocket): void {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of clients) {
    if (c === except) continue;
    if (c.readyState === 1) {
      try { c.send(payload); } catch {}
    }
  }
}

// app/api/chat/route.ts
import type { WebSocket } from 'ws';
import { clients, broadcast } from '../../../modules/chat/clients.ts';

export function GET() {
  return new Response(
    'Open a WebSocket to this URL. Currently connected: ' + clients.size + '\\n',
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

export function WS(ws: WebSocket) {
  clients.add(ws);
  broadcast({ kind: 'join', count: clients.size }, ws);

  ws.on('message', (data) =&gt; {
    let msg: { text?: string };
    try { msg = JSON.parse(data.toString()); } catch { msg = { text: data.toString() }; }
    broadcast({
      kind: 'say',
      text: String(msg.text || '').slice(0, 500),
      at: Date.now(),
    });
  });

  ws.on('close', () =&gt; {
    clients.delete(ws);
    broadcast({ kind: 'leave', count: clients.size });
  });
}</pre>

    <h3>Client Component</h3>
    <pre>// components/live-chat.ts
import { WebComponent, html, css, connectWS } from 'webjs';

export class LiveChat extends WebComponent {
  static styles = css\`
    :host { display: flex; flex-direction: column; height: 400px; border: 1px solid #ccc; border-radius: 8px; overflow: hidden; }
    .messages { flex: 1; overflow-y: auto; padding: 12px; }
    .message { margin: 4px 0; }
    .meta { color: #888; font-size: 12px; }
    form { display: flex; padding: 8px; border-top: 1px solid #ccc; }
    input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
    button { margin-left: 8px; padding: 8px 16px; }
  \`;

  conn = null;
  state = { messages: [], connected: false };

  connectedCallback() {
    super.connectedCallback();
    this.conn = connectWS('/api/chat', {
      onOpen: () =&gt; this.setState({ connected: true }),
      onClose: () =&gt; this.setState({ connected: false }),
      onMessage: (msg) =&gt; {
        this.setState({
          messages: [...this.state.messages.slice(-99), msg],
        });
      },
    });
  }

  disconnectedCallback() {
    this.conn?.close();
  }

  handleSend(e) {
    e.preventDefault();
    const input = this.shadowRoot.querySelector('input');
    if (!input.value.trim()) return;
    this.conn.send({ text: input.value });
    input.value = '';
  }

  render() {
    const { messages, connected } = this.state;
    return html\`
      &lt;div class="messages"&gt;
        \${messages.map(m =&gt; {
          if (m.kind === 'say') {
            return html\`&lt;div class="message"&gt;\${m.text} &lt;span class="meta"&gt;\${new Date(m.at).toLocaleTimeString()}&lt;/span&gt;&lt;/div&gt;\`;
          }
          if (m.kind === 'join') return html\`&lt;div class="meta"&gt;Someone joined (\${m.count} online)&lt;/div&gt;\`;
          if (m.kind === 'leave') return html\`&lt;div class="meta"&gt;Someone left (\${m.count} online)&lt;/div&gt;\`;
          return html\`&lt;div class="meta"&gt;\${JSON.stringify(m)}&lt;/div&gt;\`;
        })}
      &lt;/div&gt;
      &lt;form @submit=\${(e) =&gt; this.handleSend(e)}&gt;
        &lt;input placeholder="\${connected ? 'Type a message...' : 'Reconnecting...'}" ?disabled=\${!connected} /&gt;
        &lt;button type="submit" ?disabled=\${!connected}&gt;Send&lt;/button&gt;
      &lt;/form&gt;
    \`;
  }
}
customElements.define('live-chat', LiveChat);</pre>

    <p>Use it in a page:</p>
    <pre>// app/chat/page.ts
import { html } from 'webjs';
import '../../components/live-chat.ts';

export const metadata = { title: 'Live Chat' };

export default function ChatPage() {
  return html\`
    &lt;h1&gt;Live Chat&lt;/h1&gt;
    &lt;live-chat&gt;&lt;/live-chat&gt;
  \`;
}</pre>

    <h2>Example: Live Comments (Pub/Sub Bus + WS)</h2>
    <p>A more structured pattern uses a per-topic pub/sub bus so each post's comment section only receives relevant updates:</p>

    <h3>Pub/Sub Bus</h3>
    <pre>// modules/pubsub.ts
import type { WebSocket } from 'ws';

declare global {
  var __webjs_pubsub: Map&lt;string, Set&lt;WebSocket&gt;&gt; | undefined;
}

const topics: Map&lt;string, Set&lt;WebSocket&gt;&gt; =
  globalThis.__webjs_pubsub ??
  (globalThis.__webjs_pubsub = new Map());

export function subscribe(topic: string, ws: WebSocket): void {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic)!.add(ws);
  ws.on('close', () =&gt; {
    topics.get(topic)?.delete(ws);
    if (topics.get(topic)?.size === 0) topics.delete(topic);
  });
}

export function publish(topic: string, msg: unknown): void {
  const subs = topics.get(topic);
  if (!subs) return;
  const payload = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws.readyState === 1) {
      try { ws.send(payload); } catch {}
    }
  }
}</pre>

    <h3>WebSocket Route</h3>
    <pre>// app/api/comments/[postId]/ws/route.ts
import type { WebSocket } from 'ws';
import { subscribe, publish } from '../../../../../modules/pubsub.ts';

export function WS(ws: WebSocket, req: Request, { params }: { params: { postId: string } }) {
  const topic = 'comments:' + params.postId;
  subscribe(topic, ws);

  ws.on('message', async (data) =&gt; {
    const msg = JSON.parse(data.toString());
    // Save comment to database
    const comment = await db.comment.create({
      data: { postId: Number(params.postId), text: msg.text, author: msg.author },
    });
    // Publish to all subscribers watching this post
    publish(topic, { kind: 'new-comment', comment });
  });
}</pre>

    <h3>Client Component</h3>
    <pre>// components/live-comments.ts
import { WebComponent, html, css, connectWS } from 'webjs';

export class LiveComments extends WebComponent {
  static properties = { postId: { type: Number } };
  static styles = css\`
    :host { display: block; }
    .comment { padding: 8px 0; border-bottom: 1px solid #eee; }
    .author { font-weight: bold; }
  \`;

  postId = 0;
  conn = null;
  state = { comments: [] };

  connectedCallback() {
    super.connectedCallback();
    if (this.postId) {
      this.conn = connectWS('/api/comments/' + this.postId + '/ws', {
        onMessage: (msg) =&gt; {
          if (msg.kind === 'new-comment') {
            this.setState({
              comments: [...this.state.comments, msg.comment],
            });
          }
        },
      });
    }
  }

  disconnectedCallback() {
    this.conn?.close();
  }

  handleSubmit(e) {
    e.preventDefault();
    const input = this.shadowRoot.querySelector('input');
    this.conn?.send({ text: input.value, author: 'Anonymous' });
    input.value = '';
  }

  render() {
    return html\`
      &lt;div&gt;
        \${this.state.comments.map(c =&gt; html\`
          &lt;div class="comment"&gt;
            &lt;span class="author"&gt;\${c.author}&lt;/span&gt;: \${c.text}
          &lt;/div&gt;
        \`)}
      &lt;/div&gt;
      &lt;form @submit=\${(e) =&gt; this.handleSubmit(e)}&gt;
        &lt;input placeholder="Add a comment..." /&gt;
        &lt;button type="submit"&gt;Post&lt;/button&gt;
      &lt;/form&gt;
    \`;
  }
}
customElements.define('live-comments', LiveComments);</pre>

    <p>Usage in a page:</p>
    <pre>// app/posts/[slug]/page.ts
import { html } from 'webjs';
import '../../../components/live-comments.ts';

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await db.post.findUnique({ where: { slug: params.slug } });
  if (!post) throw notFound();
  return html\`
    &lt;article&gt;
      &lt;h1&gt;\${post.title}&lt;/h1&gt;
      &lt;div&gt;\${post.body}&lt;/div&gt;
    &lt;/article&gt;
    &lt;h2&gt;Comments&lt;/h2&gt;
    &lt;live-comments post-id="\${post.id}"&gt;&lt;/live-comments&gt;
  \`;
}</pre>

    <h2>Coexisting with HTTP Handlers</h2>
    <p>A single <code>route.ts</code> can export both HTTP methods and <code>WS</code>. This is useful for providing a REST fallback alongside the WebSocket endpoint:</p>

    <pre>// app/api/events/route.ts
import type { WebSocket } from 'ws';

// HTTP: return recent events as JSON
export async function GET() {
  const events = await db.event.findMany({ take: 50, orderBy: { createdAt: 'desc' } });
  return Response.json(events);
}

// WS: stream events in real time
export function WS(ws: WebSocket) {
  const listener = (event: unknown) =&gt; {
    if (ws.readyState === 1) ws.send(JSON.stringify(event));
  };
  eventBus.on('new-event', listener);
  ws.on('close', () =&gt; eventBus.off('new-event', listener));
}</pre>

    <h2>Dynamic Route Params with WebSockets</h2>
    <p>Dynamic segments in WebSocket routes work exactly like in API routes:</p>

    <pre>// app/api/rooms/[roomId]/route.ts
import type { WebSocket } from 'ws';

export function WS(ws: WebSocket, req: Request, { params }: { params: { roomId: string } }) {
  const room = params.roomId;  // e.g. "general" for ws://localhost:3000/api/rooms/general
  joinRoom(room, ws);
  ws.on('message', (data) =&gt; broadcastToRoom(room, data.toString(), ws));
  ws.on('close', () =&gt; leaveRoom(room, ws));
}</pre>

    <h2>Summary</h2>
    <ul>
      <li>Export <code>WS</code> from any <code>route.ts</code> to create a WebSocket endpoint</li>
      <li>The handler receives <code>(ws, req, { params })</code> -- the ws socket, the upgrade Request (for auth/cookies), and dynamic route params</li>
      <li>Uses the <code>ws</code> library under the hood with HTTP/1.1 Upgrade</li>
      <li>Client: <code>connectWS(url, handlers)</code> with auto-reconnect (exponential backoff, capped at 30s)</li>
      <li>Outgoing objects are JSON-stringified; incoming text is JSON-parsed when possible</li>
      <li>Messages sent while disconnected are queued and flushed on reconnect</li>
      <li>Use the <code>globalThis</code> pattern for shared state that survives dev-mode module reloads</li>
      <li>WebSocket and HTTP handlers coexist in the same <code>route.ts</code> file</li>
    </ul>
  `;
}
