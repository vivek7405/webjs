/**
 * Publish/subscribe for live comments — thin wrapper around the framework's
 * {@link getPubSub} from `@webjs/server`.
 *
 * Uses string channels of the form `comments:<postId>` and JSON-serialises
 * each comment. In dev mode this is in-process memory; set `REDIS_URL` for
 * multi-instance deployments (handled transparently by the framework).
 */
import { getPubSub } from '@webjs/server';
import type { CommentFormatted } from '../types.ts';

type Subscriber = (comment: CommentFormatted) => void;

const channelFor = (postId: number) => `comments:${postId}`;

/** Subscribe to new comments for a given postId. Returns an unsubscribe fn. */
export function subscribe(postId: number, fn: Subscriber): () => void {
  const ps = getPubSub();
  const channel = channelFor(postId);
  const handler = (message: string) => {
    try { fn(JSON.parse(message)); } catch { /* bad payload — skip */ }
  };
  ps.subscribe(channel, handler);
  return () => { ps.unsubscribe(channel, handler); };
}

export function publish(postId: number, comment: CommentFormatted): void {
  getPubSub().publish(channelFor(postId), JSON.stringify(comment));
}
