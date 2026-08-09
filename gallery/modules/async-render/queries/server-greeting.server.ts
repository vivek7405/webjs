'use server';
// A GET 'use server' query a component awaits directly inside `async render()`.
// It returns request-time SERVER data the client cannot know, which is exactly
// what async render() is for (the resolved value lands in the first paint).
export const method = 'GET';

export async function serverGreeting(): Promise<{ at: string; pid: number }> {
  return { at: new Date().toISOString(), pid: process.pid };
}
