export interface ConnectOptions {
  onOpen?: (ev: Event) => void;
  onMessage?: (data: unknown, ev: MessageEvent) => void;
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
