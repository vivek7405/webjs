// The WebSocket endpoint for the websockets feature demo. A route.ts is a
// server-only HTTP file; exporting WS(ws, req, ctx) upgrades it to a WebSocket
// endpoint. `ws` is a standard ws-library socket: listen with ws.on('message'),
// reply with ws.send(). In dev the module is re-imported per connection, so keep
// shared state on globalThis if you need it (this echo endpoint is stateless).

// Structural type for the socket, so the demo needs no `@types/ws` dependency.
type WSLike = {
  on(event: 'message' | 'close', cb: (data: Buffer) => void): void;
  send(msg: string): void;
};

export function WS(ws: WSLike) {
  ws.on('message', (data) => {
    // Echo the text back to just this client. For a fan-out to ALL connected
    // clients, use broadcast() from '@webjsdev/server' (see the broadcast demo).
    ws.send('echo: ' + data.toString());
  });
}
