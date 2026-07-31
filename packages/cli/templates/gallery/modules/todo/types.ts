// The row shape is DERIVED from the schema, never re-declared: rename a column
// in db/schema.server.ts and every consumer of this type is a compile error
// instead of a silent `undefined` at runtime.
//
// `import type` is what makes that safe here. This type is imported by the
// browser-shipped <todo-app> component, and a VALUE import from a
// `db/*.server.ts` file would pin the component to a server module and crash it
// at load (webjs check's no-server-import-in-browser-module flags it). A
// type-only import is erased by the TypeScript stripper before it can reach the
// browser, so it is exempt from that rule and costs the client nothing.
import type { todos } from '#db/schema.server.ts';

type TodoRow = typeof todos.$inferSelect;

export interface Todo extends TodoRow {
  pending?: boolean; // client-only: true while an optimistic create is in flight
}
