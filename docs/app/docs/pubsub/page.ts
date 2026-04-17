import { html } from 'webjs';

export const metadata = { title: 'Pub/Sub — webjs' };

export default function PubSub() {
  return html`
    <h1>Pub/Sub</h1>
    <p>webjs includes a publish/subscribe system designed for scaling WebSocket connections across multiple server instances. Following the <strong>opinionated defaults</strong> philosophy: in-memory pub/sub for development, automatic switch to Redis pub/sub in production.</p>

    <h2>Zero-Config Convention</h2>
    <pre># Development — nothing to configure
# webjs uses memoryPubSub automatically (single process)

# Production — set one env var
REDIS_URL=redis://localhost:6379</pre>

    <p>In development with a single server process, <code>memoryPubSub</code> routes messages between WebSocket connections in the same process. In production, <code>redisPubSub</code> uses Redis pub/sub channels to broadcast messages across all server instances. No code changes required.</p>

    <h2>The Problem It Solves</h2>
    <p>When you run a single server instance, broadcasting a WebSocket message to all connected clients is trivial — they are all in the same process. But in production you typically run multiple instances behind a load balancer. A user connected to instance A sends a chat message, but users connected to instance B never see it.</p>

    <p>Pub/Sub solves this by relaying messages through a shared channel (Redis) so every instance receives every broadcast and can forward it to its local WebSocket connections.</p>

    <h2>Backends</h2>
    <h3>memoryPubSub (default)</h3>
    <p>An in-process event emitter. Messages published on one channel are delivered to all subscribers in the same process. Zero dependencies, perfect for development.</p>

    <h3>redisPubSub (production)</h3>
    <p>Uses Redis <code>PUBLISH</code>/<code>SUBSCRIBE</code> commands to relay messages across all server instances connected to the same Redis. Activated automatically when <code>REDIS_URL</code> is present.</p>

    <h2>API</h2>
    <pre>import { pubsub } from '@webjs/server';</pre>

    <h3>pubsub.publish(channel, message)</h3>
    <p>Publishes a message to all subscribers on the given channel, across all server instances.</p>

    <pre>await pubsub.publish('chat:room-42', {
  user: 'Ada',
  text: 'Hello everyone!',
  timestamp: Date.now(),
});</pre>

    <h3>pubsub.subscribe(channel, callback)</h3>
    <p>Subscribes to a channel. The callback is invoked for every message published to that channel, including messages from other server instances.</p>

    <pre>const unsubscribe = await pubsub.subscribe('chat:room-42', (message) => {
  // message is the deserialized object from publish()
  console.log(message.user, ':', message.text);
});

// Later — clean up
unsubscribe();</pre>

    <h2>Example: Chat Room Across Instances</h2>
    <p>This is the canonical use case. A WebSocket route that broadcasts messages to all connected clients, regardless of which server instance they are connected to:</p>

    <pre>// app/ws/chat/[roomId]/route.server.js
import { pubsub } from '@webjs/server';

export function OPEN(ws, req) {
  const { roomId } = req.params;
  const channel = \`chat:\${roomId}\`;

  // Subscribe this connection to the room
  const unsubscribe = await pubsub.subscribe(channel, (message) => {
    ws.send(JSON.stringify(message));
  });

  // Store cleanup function for CLOSE handler
  ws.data = { unsubscribe, channel };
}

export function MESSAGE(ws, req, message) {
  const { channel } = ws.data;
  const parsed = JSON.parse(message);

  // Publish to all instances — every subscriber receives this
  pubsub.publish(channel, {
    user: parsed.user,
    text: parsed.text,
    timestamp: Date.now(),
  });
}

export function CLOSE(ws) {
  // Unsubscribe when the client disconnects
  ws.data.unsubscribe?.();
}</pre>

    <h2>Example: Live Notifications</h2>
    <pre>// Publish from anywhere — API route, server action, background job
import { pubsub } from '@webjs/server';

// When an order ships, notify the user across all instances
await pubsub.publish(\`notifications:\${userId}\`, {
  type: 'order-shipped',
  orderId: order.id,
  message: \`Your order #\${order.id} has shipped!\`,
});

// WebSocket route subscribes to user-specific channels
// app/ws/notifications/route.server.js
export function OPEN(ws, req) {
  const userId = req.session.userId;
  const unsub = await pubsub.subscribe(\`notifications:\${userId}\`, (msg) => {
    ws.send(JSON.stringify(msg));
  });
  ws.data = { unsub };
}

export function CLOSE(ws) {
  ws.data.unsub?.();
}</pre>

    <h2>How Scaling Works</h2>
    <p>With <code>REDIS_URL</code> set and multiple instances running:</p>
    <ol>
      <li>Instance A calls <code>pubsub.publish('chat:room-42', msg)</code>.</li>
      <li>The message is sent to the Redis <code>chat:room-42</code> channel via <code>PUBLISH</code>.</li>
      <li>Instances B and C, which have active <code>SUBSCRIBE</code> connections to Redis, receive the message.</li>
      <li>Each instance forwards it to its locally connected WebSocket clients.</li>
    </ol>
    <p>The result: every client in every instance sees the message, with no application-level routing code needed.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/websockets">WebSockets</a> — the WebSocket route API that pub/sub complements</li>
      <li><a href="/docs/cache">Cache Store</a> — the shared Redis connection pub/sub uses</li>
      <li><a href="/docs/jobs">Background Jobs</a> — trigger pub/sub events from background job handlers</li>
    </ul>
  `;
}
