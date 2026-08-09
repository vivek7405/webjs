// A page that throws unauthorized(). In a real app you would call this when the
// request is not authenticated (no valid session), typically to prompt a sign-in.
// Here it throws unconditionally so the demo always shows the 401 boundary. The
// nearest unauthorized.ts (this folder's sibling) renders in place of this page
// at status 401; without a nearest one the framework renders a default 401 page.
import { unauthorized } from '@webjsdev/core';

export default function Private() {
  unauthorized();
}
