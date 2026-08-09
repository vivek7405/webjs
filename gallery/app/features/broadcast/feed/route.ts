// The WebSocket endpoint for the broadcast demo. Unlike the echo endpoint, this
// fans each incoming message out to EVERY client on the path with broadcast()
// from '@webjsdev/server'. The framework auto-registers each connection to its
// route path, so broadcast('/features/broadcast/feed', ...) reaches all of them.
import { broadcast } from '@webjsdev/server';

// Structural type for the socket, so the demo needs no `@types/ws` dependency.
type WSLike = {
  on(event: 'message' | 'close', cb: (data: Buffer) => void): void;
  send(msg: string): void;
};

export function WS(ws: WSLike) {
  ws.on('message', (data) => {
    // Fan out to every connected client (the sender included, so all open tabs
    // stay in sync). Pass { except: ws } if you want to skip the sender.
    broadcast('/features/broadcast/feed', data.toString());
  });
}
