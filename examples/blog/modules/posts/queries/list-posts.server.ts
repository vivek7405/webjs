'use server';

import { cache } from '@webjs/server';
import { prisma } from '../../../lib/prisma.ts';
import { formatPost } from '../utils/slugify.ts';
import type { PostFormatted } from '../types.ts';

/** List the most recent posts, newest first, with author info denormalised. */
export const listPosts = cache(
  async (): Promise<PostFormatted[]> => {
    const rows = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { name: true, email: true } } },
    });
    return rows.map(formatPost);
  },
  { key: 'posts', ttl: 60 }
);
