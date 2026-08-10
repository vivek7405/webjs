// A page that throws forbidden(). In a real app you would call this only when
// an authenticated user lacks permission (checked against the session). Here it
// throws unconditionally so the demo always shows the 403 boundary. The nearest
// forbidden.ts (this folder's sibling) renders in place of this page at status
// 403; without a nearest one the framework renders a default 403 page.
import { forbidden } from '@webjsdev/core';

export default function Gated() {
  forbidden();
}
