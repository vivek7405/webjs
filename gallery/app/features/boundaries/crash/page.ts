// A page that throws a real render error, so the nearest error.ts boundary
// (../error.ts) catches it. In a real app an unexpected throw (a failed query,
// a bug) lands here; expected failures should return an ActionResult or throw
// notFound() / forbidden() instead.
export default function Crash() {
  throw new Error('demo: this page threw during render');
}
