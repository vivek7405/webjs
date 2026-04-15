import { pathToFileURL } from 'node:url';

/**
 * Dispatch an incoming request to a matched API route.
 * API modules export methods as named async functions: GET, POST, PUT, PATCH, DELETE.
 *
 * Handlers receive a standard `Request` and return a standard `Response`.
 *
 * @param {import('./router.js').ApiRoute} route
 * @param {Record<string,string>} params
 * @param {Request} webRequest
 * @param {boolean} dev
 * @returns {Promise<Response>}
 */
export async function handleApi(route, params, webRequest, dev) {
  const url = pathToFileURL(route.file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  const mod = await import(url + bust);
  const method = webRequest.method.toUpperCase();
  const handler = mod[method];
  if (!handler) {
    return new Response(`Method ${method} not allowed`, {
      status: 405,
      headers: { allow: allowedMethods(mod).join(', ') },
    });
  }
  /** @type any */ (webRequest).params = params;
  const result = await handler(webRequest, { params });
  if (result instanceof Response) return result;
  // Convenience: allow returning plain objects as JSON.
  return Response.json(result);
}

/** @param {Record<string,unknown>} mod */
function allowedMethods(mod) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => typeof mod[m] === 'function');
}
