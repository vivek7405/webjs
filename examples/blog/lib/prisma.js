'use server';

import { PrismaClient } from '@prisma/client';

/**
 * Single PrismaClient per process.
 *
 * In dev mode the module may re-import (cache-busted) per request; stashing
 * the instance on globalThis keeps connection count sane across reloads.
 *
 * @type {PrismaClient}
 */
export const prisma =
  globalThis.__webjs_prisma ?? (globalThis.__webjs_prisma = new PrismaClient());
