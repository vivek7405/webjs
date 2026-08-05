// An intentional uncaught render throw, the same shape as the scaffold's
// `app/features/boundaries/crash` demo. The overlay SHOWING here is correct
// behaviour; #1047 is about it leaking anywhere else.
export default function Crash() {
  throw new Error('demo: this page threw during render');
}
