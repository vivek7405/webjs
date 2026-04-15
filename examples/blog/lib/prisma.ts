'use server';

import { PrismaClient } from '@prisma/client';

// In dev the module may re-import per request; stash on globalThis so the
// connection pool survives reloads.
declare global {
  var __webjs_prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__webjs_prisma ?? (globalThis.__webjs_prisma = new PrismaClient());
