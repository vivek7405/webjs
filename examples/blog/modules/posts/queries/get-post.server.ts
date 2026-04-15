'use server';

import { prisma } from '../../../lib/prisma.js';
import { formatPost } from '../utils/slugify.ts';
import type { PostFormatted } from '../types.ts';

export async function getPost(input: { slug: string }): Promise<PostFormatted | null> {
  const row = await prisma.post.findUnique({
    where: { slug: input.slug },
    include: { author: { select: { name: true, email: true } } },
  });
  return row ? formatPost(row) : null;
}
