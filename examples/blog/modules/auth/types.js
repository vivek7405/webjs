/**
 * Shared types for the auth module — JSDoc-only.
 *
 * @typedef {{
 *   id: number,
 *   email: string,
 *   name: string | null,
 *   createdAt: Date,
 * }} PublicUser
 *
 * Use `ActionResult<T>` for any action that can fail with a user-facing
 * message. The shape matches pilot-platform's convention so routes can
 * translate `{ success: false, error, status }` to HTTP responses mechanically.
 *
 * @template T
 * @typedef {
 *   | { success: true, data: T }
 *   | { success: false, error: string, status: number }
 * } ActionResult
 */
export {};
