export interface ConnectOptions {
  onOpen?: (ev: Event) => void;
  // `any`, matching the JSDoc, and load-bearing rather than lazy: the socket
  // delivers an arbitrary JSON payload, and the contract is that the CALLER
  // names the shape it expects (`(msg: ChatMessage) => ...`). Narrowing this to
  // `unknown` type-checks here and breaks every such handler, which is not a
  // change a PR filling in missing declarations gets to make.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessage?: (data: any, ev: MessageEvent) => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  protocols?: string | string[];
  reconnect?: boolean;
}

export interface WSConnection {
  send(data: string | ArrayBuffer | ArrayBufferView | object): void;
  close(code?: number, reason?: string): void;
  readonly socket: WebSocket | null;
  readonly readyState: 0 | 1 | 2 | 3;
}

export function connectWS(url: string, opts?: ConnectOptions): WSConnection;
