// Per-segment middleware: applies the cookie session to every request under
// /features/sessions, so getSession(req) works in the route below. Middleware
// nests by folder (outermost to innermost); this one scopes the session to just
// this feature. A root middleware.ts would apply it app-wide.
import { cookieSessions } from '#modules/sessions/session-config.server.ts';

export default cookieSessions;
