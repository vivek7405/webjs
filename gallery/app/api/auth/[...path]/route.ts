// The createAuth HTTP endpoints (signin, signout, OAuth callbacks). This route
// stays at the app root, NOT under app/features/auth/, because createAuth
// hardcodes /api/auth/signin/* and /api/auth/callback/* for its form posts and
// OAuth redirect URIs. The rest of the auth card lives under app/features/auth/.
import { handlers } from '#modules/auth/auth.server.ts';
export const GET = handlers.GET;
export const POST = handlers.POST;
