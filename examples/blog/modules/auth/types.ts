/**
 * Shared types for the auth module.
 */
export type PublicUser = {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
};

/**
 * Return envelope for any action that can fail with a user-facing message.
 * Matches pilot-platform's convention so routes can translate to HTTP
 * status codes mechanically.
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };
