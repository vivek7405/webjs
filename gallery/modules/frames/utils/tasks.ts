// Pure data plus a filter for the frames demo. No server-only deps and no
// 'use server', so it is a plain browser-safe .ts the page reads during SSR to
// render the frame's current contents. The frame swap re-renders THIS list in
// place from the ?status query, shipping no component JS.
export type Status = 'all' | 'active' | 'done';
export interface Task {
  title: string;
  done: boolean;
}

const TASKS: Task[] = [
  { title: 'Draft the release notes', done: true },
  { title: 'Review the frames demo', done: false },
  { title: 'Ship the gallery update', done: false },
  { title: 'Reply on the tracking issue', done: true },
];

// Coerce an untrusted ?status value to a known Status (defaults to 'all').
export function normalizeStatus(raw: unknown): Status {
  return raw === 'active' || raw === 'done' ? raw : 'all';
}

export function filterTasks(status: Status): Task[] {
  if (status === 'active') return TASKS.filter((t) => !t.done);
  if (status === 'done') return TASKS.filter((t) => t.done);
  return TASKS;
}
