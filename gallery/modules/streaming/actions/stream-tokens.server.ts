'use server';
// A STREAMING server action (#489). Detection is purely on the RETURN VALUE, no
// config export: an action that returns a ReadableStream / async iterable /
// async generator streams its chunks over the single RPC response instead of
// buffering. Each `yield` is rich-serialized and flushed as it is produced, so
// the call site sees tokens arrive live. Back-pressure is respected and the
// generator is cancelled if the client disconnects. A streamed result is never
// cached / ETagged / seeded. One function per file, like every action.
export async function* streamTokens(prompt: string): AsyncGenerator<string> {
  const words = `Streaming ${prompt} one token at a time, straight from the server.`.split(' ');
  for (const word of words) {
    // A deliberate per-token delay so the streaming is visible; a real action
    // would yield as its upstream (an LLM, a DB cursor, a log tail) produces.
    await new Promise((r) => setTimeout(r, 140));
    yield word + ' ';
  }
}
