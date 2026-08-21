// `body` is widened off `RequestInit` on purpose: richFetch also accepts a plain
// object, which it serializes with the WebJs wire format. `Omit` first, because
// an intersection would narrow the property back to `BodyInit | null`.
export function richFetch<T>(url: string | URL, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T>;
