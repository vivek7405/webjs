'use server';

import { getStore } from '@webjs/server';
import { prisma } from '../../../lib/prisma.ts';
import { formatPost } from '../utils/slugify.ts';
import type { PostFormatted } from '../types.ts';

const CACHE_KEY = 'posts:list';
const CACHE_TTL_MS = 30_000; // 30 seconds

/** List the most recent posts, newest first, with author info denormalised. */
export async function listPosts(): Promise<PostFormatted[]> {
  const cache = getStore();
  const cached = await cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const rows = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { name: true, email: true } } },
  });
  const posts = rows.map(formatPost);
  await cache.set(CACHE_KEY, JSON.stringify(posts), CACHE_TTL_MS);
  return posts;
}
