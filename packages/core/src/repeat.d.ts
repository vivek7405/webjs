// The runtime value also carries a module-private `Symbol.for('webjs.repeat')`
// key, the marker the renderers check. It is deliberately absent here: it is not
// exported, so it cannot be named, and no consumer constructs one by hand.
export interface RepeatDirective<T> {
  items: T[];
  keyFn: (item: T, i: number) => string | number;
  templateFn: (item: T, i: number) => unknown;
}

export function repeat<T>(
  items: Iterable<T>,
  keyFn: (item: T, i: number) => string | number,
  templateFn: (item: T, i: number) => unknown,
): RepeatDirective<T>;
export function isRepeat(x: unknown): x is RepeatDirective<unknown>;
