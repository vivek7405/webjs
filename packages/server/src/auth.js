/**
 * NextAuth/Auth.js-style authentication for webjs.
 *
 * JWT or database sessions, Credentials + OAuth (Google, GitHub) providers.
 * Uses Web Crypto HMAC-SHA256 — no external dependencies.
 *
 * @module auth
 */

import { getStore } from './cache.js';
import { getRequest } from './context.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const AUTH_COOKIE = 'webjs.auth';
const STATE_COOKIE = 'webjs.auth.state';
const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60; // 30 days (seconds)

// -- Web Crypto helpers -----------------------------------------------------

/** @param {string} secret @returns {Promise<CryptoKey>} */
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** @param {ArrayBuffer} buf @returns {string} */
function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} str @returns {Uint8Array} */
function unb64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Sign `value` → `value.sig` */
async function sign(value, secret) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(value));
  return `${value}.${b64url(sig)}`;
}

/** Verify and unsign. Returns original value or null. */
async function unsign(input, secret) {
  const idx = input.lastIndexOf('.');
  if (idx < 1) return null;
  const value = input.slice(0, idx);
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(input.slice(idx + 1)), enc.encode(value));
  return ok ? value : null;
}

function randomId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return b64url(bytes.buffer);
}

// -- Cookie helpers ---------------------------------------------------------

/** @param {string} header @returns {Record<string,string>} */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    out[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return out;
}

function setCookie(name, value, maxAge, secure) {
  let s = `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=Lax`;
  if (secure) s += '; Secure';
  return s;
}

function clearCookie(name) {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

// -- JWT --------------------------------------------------------------------

/** @param {Record<string,unknown>} payload @param {string} secret */
async function encodeJwt(payload, secret) {
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const unsigned = `${h}.${p}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

/** @param {string} token @param {string} secret @returns {Promise<Record<string,unknown>|null>} */
async function decodeJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(unb64url(parts[1])));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// -- Providers --------------------------------------------------------------

/**
 * @typedef {Object} ProviderConfig
 * @property {string} id
 * @property {string} type
 * @property {string} [name]
 * @property {string} [authorizationUrl]
 * @property {string} [tokenUrl]
 * @property {string} [userinfoUrl]
 * @property {string} [clientId]
 * @property {string} [clientSecret]
 * @property {string[]} [scope]
 * @property {((creds: Record<string,unknown>) => Promise<Record<string,unknown>|null>)} [authorize]
 * @property {((profile: Record<string,unknown>) => Record<string,unknown>)} [profile]
 */

/**
 * Credentials provider — email/password or custom logic.
 * @param {{ authorize: (creds: Record<string,unknown>) => Promise<Record<string,unknown>|null> }} opts
 * @returns {ProviderConfig}
 */
export function Credentials(opts) {
  return { id: 'credentials', type: 'credentials', name: 'Credentials', authorize: opts.authorize };
}

/**
 * Google OAuth 2.0 provider.
 * @param {{ clientId?: string, clientSecret?: string }} [opts]
 * @returns {ProviderConfig}
 */
export function Google(opts = {}) {
  return {
    id: 'google', type: 'oauth', name: 'Google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    clientId: opts.clientId || process.env.AUTH_GOOGLE_ID,
    clientSecret: opts.clientSecret || process.env.AUTH_GOOGLE_SECRET,
    scope: ['openid', 'email', 'profile'],
    profile: (p) => ({ id: String(p.sub), name: p.name, email: p.email, image: p.picture }),
  };
}

/**
 * GitHub OAuth 2.0 provider.
 * @param {{ clientId?: string, clientSecret?: string }} [opts]
 * @returns {ProviderConfig}
 */
export function GitHub(opts = {}) {
  return {
    id: 'github', type: 'oauth', name: 'GitHub',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    clientId: opts.clientId || process.env.AUTH_GITHUB_ID,
    clientSecret: opts.clientSecret || process.env.AUTH_GITHUB_SECRET,
    scope: ['read:user', 'user:email'],
    profile: (p) => ({ id: String(p.id), name: p.name || p.login, email: p.email, image: p.avatar_url }),
  };
}

// -- createAuth -------------------------------------------------------------

/**
 * @typedef {Object} AuthConfig
 * @property {ProviderConfig[]} providers
 * @property {{ strategy?: 'jwt'|'database', maxAge?: number }} [session]
 * @property {string} secret
 * @property {{ session?: Function, jwt?: Function, signIn?: Function, redirect?: Function }} [callbacks]
 * @property {{ load?: Function, save?: Function, destroy?: Function }} [adapter]
 * @property {{ signIn?: string, signOut?: string, error?: string }} [pages]
 */

/**
 * Create the auth system.
 * @param {AuthConfig} config
 * @returns {{
 *   auth: (req?: Request) => Promise<{ user: Record<string,unknown> }|null>,
 *   signIn: (provider: string, data?: Record<string,unknown>, opts?: { redirectTo?: string, req?: Request }) => Promise<Response>,
 *   signOut: (opts?: { redirectTo?: string, req?: Request }) => Promise<Response>,
 *   handlers: { GET: (req: Request) => Promise<Response>, POST: (req: Request) => Promise<Response> },
 * }}
 */
export function createAuth(config) {
  const { secret } = config;
  if (!secret) throw new Error('createAuth() requires a `secret` (set AUTH_SECRET or SESSION_SECRET)');

  const strategy = config.session?.strategy || 'jwt';
  const maxAge = config.session?.maxAge || DEFAULT_MAX_AGE;
  const maxAgeMs = maxAge * 1000;
  const cb = config.callbacks || {};
  const pages = config.pages || {};
  const secure = () => process.env.NODE_ENV === 'production';

  /** @type {Map<string, ProviderConfig>} */
  const providers = new Map();
  for (const p of config.providers) providers.set(p.id, p);

  const dbStore = strategy === 'database' ? (config.adapter || defaultAdapter()) : null;

  // -- Session read/write ---------------------------------------------------

  async function readSession(req) {
    const cookies = parseCookies(req.headers.get('cookie') || '');
    const raw = cookies[AUTH_COOKIE];
    if (!raw) return null;

    if (strategy === 'jwt') {
      const payload = await decodeJwt(raw, secret);
      if (!payload) return null;
      let token = cb.jwt ? await cb.jwt({ token: payload, user: undefined }) : payload;
      let session = { user: { id: token.sub, name: token.name, email: token.email, image: token.image, ...token } };
      delete session.user.iat; delete session.user.exp; delete session.user.sub;
      return cb.session ? cb.session({ session, token, user: undefined }) : session;
    }

    const sid = await unsign(raw, secret);
    if (!sid || !dbStore) return null;
    const data = await dbStore.load(sid);
    if (!data) return null;
    let session = { user: data };
    return cb.session ? cb.session({ session, token: undefined, user: data }) : session;
  }

  async function writeSession(user) {
    if (strategy === 'jwt') {
      let token = { sub: user.id, name: user.name, email: user.email, image: user.image, role: user.role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + maxAge };
      if (cb.jwt) token = await cb.jwt({ token, user });
      return setCookie(AUTH_COOKIE, await encodeJwt(token, secret), maxAgeMs, secure());
    }
    const sid = randomId();
    await dbStore.save(sid, user, maxAgeMs);
    return setCookie(AUTH_COOKIE, await sign(sid, secret), maxAgeMs, secure());
  }

  // -- auth() ---------------------------------------------------------------

  async function auth(req) {
    const r = req || getRequest();
    return r ? readSession(r) : null;
  }

  // -- signIn() -------------------------------------------------------------

  async function signInFn(providerId, data, opts = {}) {
    const provider = providers.get(providerId);
    if (!provider) return new Response('Unknown provider', { status: 400 });

    if (provider.type === 'credentials') {
      if (!provider.authorize) return new Response('No authorize function', { status: 500 });
      const user = await provider.authorize(data || {});
      if (!user) {
        return new Response(null, { status: 302, headers: { location: `${pages.error || pages.signIn || '/'}?error=CredentialsSignin` } });
      }
      if (cb.signIn) {
        const ok = await cb.signIn({ user, account: { provider: providerId } });
        if (ok === false) return new Response(null, { status: 302, headers: { location: pages.error || '/?error=AccessDenied' } });
      }
      const cookie = await writeSession(user);
      const redirectTo = opts.redirectTo || (data && data.redirectTo) || '/';
      return new Response(null, { status: 302, headers: { location: /** @type {string} */ (redirectTo), 'set-cookie': cookie } });
    }

    if (provider.type === 'oauth') return oauthRedirect(provider, opts);
    return new Response('Unsupported provider type', { status: 400 });
  }

  // -- signOut() ------------------------------------------------------------

  async function signOutFn(opts = {}) {
    const hdrs = new Headers();
    hdrs.set('location', opts.redirectTo || pages.signOut || '/');
    hdrs.append('set-cookie', clearCookie(AUTH_COOKIE));

    if (strategy === 'database' && dbStore) {
      const r = opts.req || getRequest();
      if (r) {
        const raw = parseCookies(r.headers.get('cookie') || '')[AUTH_COOKIE];
        if (raw) { const sid = await unsign(raw, secret); if (sid) await dbStore.destroy(sid); }
      }
    }
    return new Response(null, { status: 302, headers: hdrs });
  }

  // -- OAuth helpers --------------------------------------------------------

  async function oauthRedirect(provider, opts) {
    const req = opts.req || getRequest();
    const origin = req ? new URL(req.url).origin : 'http://localhost:3000';
    const state = randomId();

    const url = new URL(provider.authorizationUrl);
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', `${origin}/api/auth/callback/${provider.id}`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', (provider.scope || []).join(' '));
    url.searchParams.set('state', state);

    const hdrs = new Headers();
    hdrs.set('location', url.toString());
    hdrs.append('set-cookie', setCookie(STATE_COOKIE, await sign(state, secret), 600_000, secure()));
    return new Response(null, { status: 302, headers: hdrs });
  }

  async function oauthCallback(req, provider) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return new Response('Missing code or state', { status: 400 });

    const rawState = parseCookies(req.headers.get('cookie') || '')[STATE_COOKIE];
    if (!rawState) return new Response('Missing state cookie', { status: 403 });
    const verified = await unsign(rawState, secret);
    if (!verified || verified !== state) return new Response('Invalid state', { status: 403 });

    // Exchange code for token
    const callbackUrl = `${url.origin}/api/auth/callback/${provider.id}`;
    const tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: provider.clientId, client_secret: provider.clientSecret, code, redirect_uri: callbackUrl, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) return new Response('Token exchange failed', { status: 502 });
    const { access_token: accessToken } = await tokenRes.json();
    if (!accessToken) return new Response('No access token', { status: 502 });

    // Fetch profile
    const profileRes = await fetch(provider.userinfoUrl, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!profileRes.ok) return new Response('Profile fetch failed', { status: 502 });
    const rawProfile = await profileRes.json();

    // GitHub private email fallback
    if (provider.id === 'github' && !rawProfile.email) {
      try {
        const r = await fetch('https://api.github.com/user/emails', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
        if (r.ok) { const emails = await r.json(); const p = emails.find(/** @param {any} e */ e => e.primary && e.verified); if (p) rawProfile.email = p.email; }
      } catch { /* non-critical */ }
    }

    const user = provider.profile ? provider.profile(rawProfile) : rawProfile;

    if (cb.signIn) {
      const ok = await cb.signIn({ user, account: { provider: provider.id, accessToken } });
      if (ok === false) return new Response(null, { status: 302, headers: { location: pages.error || '/?error=AccessDenied' } });
    }

    const hdrs = new Headers();
    hdrs.set('location', '/');
    hdrs.append('set-cookie', await writeSession(user));
    hdrs.append('set-cookie', clearCookie(STATE_COOKIE));
    return new Response(null, { status: 302, headers: hdrs });
  }

  // -- Route handlers (mount at app/api/auth/[...path]/route.js) ------------

  function parseSegments(req) {
    return new URL(req.url).pathname.replace(/^\/api\/auth\/?/, '').split('/').filter(Boolean);
  }

  async function GET(req) {
    const seg = parseSegments(req);

    if (seg[0] === 'session') {
      return new Response(JSON.stringify(await readSession(req)), { headers: { 'content-type': 'application/json' } });
    }
    if (seg[0] === 'signin' && seg[1]) {
      const p = providers.get(seg[1]);
      if (!p || p.type !== 'oauth') return new Response('Unknown OAuth provider', { status: 404 });
      return oauthRedirect(p, { req });
    }
    if (seg[0] === 'callback' && seg[1]) {
      const p = providers.get(seg[1]);
      if (!p || p.type !== 'oauth') return new Response('Unknown OAuth provider', { status: 404 });
      return oauthCallback(req, p);
    }
    if (seg[0] === 'signout') return signOutFn({ req });
    if (seg[0] === 'providers') {
      const list = {};
      for (const [id, p] of providers) list[id] = { id: p.id, name: p.name, type: p.type, signinUrl: `/api/auth/signin/${id}` };
      return new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('Not found', { status: 404 });
  }

  async function POST(req) {
    const seg = parseSegments(req);

    if (seg[0] === 'signin' && seg[1]) {
      const provider = providers.get(seg[1]);
      if (!provider) return new Response('Unknown provider', { status: 404 });
      if (provider.type === 'credentials') {
        let body = {};
        const ct = req.headers.get('content-type') || '';
        if (ct.includes('json')) body = await req.json();
        else if (ct.includes('form')) { const fd = await req.formData(); for (const [k, v] of fd.entries()) body[k] = v; }
        return signInFn('credentials', body, { req });
      }
      if (provider.type === 'oauth') return oauthRedirect(provider, { req });
    }
    if (seg[0] === 'signout') return signOutFn({ req });
    return new Response('Not found', { status: 404 });
  }

  return { auth, signIn: signInFn, signOut: signOutFn, handlers: { GET, POST } };
}

// -- Default database adapter (cache store) ---------------------------------

function defaultAdapter() {
  const store = getStore();
  return {
    async load(id) { const r = await store.get(`auth:session:${id}`); if (!r) return null; try { return JSON.parse(r); } catch { return null; } },
    async save(id, data, maxAgeMs) { await store.set(`auth:session:${id}`, JSON.stringify(data), maxAgeMs); },
    async destroy(id) { await store.delete(`auth:session:${id}`); },
  };
}
