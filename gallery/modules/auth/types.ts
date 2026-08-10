export interface User {
  id: number;
  name: string | null;
  email: string;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };
