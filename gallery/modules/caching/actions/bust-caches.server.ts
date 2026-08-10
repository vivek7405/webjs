'use server';
// A mutation that evicts cached reads. After you change data, call the narrowest
// revalidate that covers the change so the next request refetches instead of
// serving a stale cache() result or a revalidate-cached page. (A configured
// action already runs its declared `invalidates` tags automatically; these are
// the same helpers, callable directly when you need finer control.)
import { revalidateTag, revalidateTags, revalidatePath, revalidateAll, getStore, memoryStore } from '@webjsdev/server';

export async function bustCaches(scope: 'tags' | 'path' | 'all' = 'tags') {
  // getStore() is the store cache() reads from (a memoryStore() in dev, a
  // redisStore() in prod via setStore()); fall back to a fresh in-memory one.
  const active = getStore();
  const store = active ?? memoryStore();

  // Evict only what changed. Pick the narrowest scope that covers the mutation.
  if (scope === 'all') {
    revalidateAll(); // nuclear: drop the whole store
  } else if (scope === 'path') {
    revalidatePath('/features/caching'); // one revalidate-cached page URL
  } else {
    revalidateTag('todos'); // one cache() tag
    revalidateTags(['todos', 'user:me']); // several tags at once
  }
  return { success: true as const, data: { evicted: scope, store: store === active ? 'active' : 'memory' } };
}
