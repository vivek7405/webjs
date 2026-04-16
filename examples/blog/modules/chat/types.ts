/** Message types sent/received over the /api/chat WebSocket. */
export type ChatMessage =
  | { kind: 'say'; text: string; at: number }
  | { kind: 'join'; count: number }
  | { kind: 'leave'; count: number };
