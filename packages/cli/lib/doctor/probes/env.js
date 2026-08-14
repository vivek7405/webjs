import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnvKeys } from '../util.js';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 3, .env presence + drift vs .env.example. WARN-level only (a missing
 * env var is the app's runtime problem, not a toolchain crash). When no
 * `.env.example`, PASS (nothing to compare). When `.env.example` exists but
 * `.env` is absent, WARN to copy it. Otherwise WARN listing any example key
 * missing from `.env`, else PASS.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
export async function checkEnv(appDir) {
  const examplePath = join(appDir, '.env.example');
  if (!existsSync(examplePath)) {
    return {
      name: 'env-drift',
      status: 'pass',
      message: 'No .env.example to compare against.',
    };
  }
  const exampleKeys = parseEnvKeys(await readFile(examplePath, 'utf8'));
  const envPath = join(appDir, '.env');
  if (!existsSync(envPath)) {
    return {
      name: 'env-drift',
      status: 'warn',
      message: '.env.example exists but .env does not.',
      fix: 'Copy it: cp .env.example .env  (then fill in the values).',
    };
  }
  const envKeys = parseEnvKeys(await readFile(envPath, 'utf8'));
  const missing = [...exampleKeys].filter((k) => !envKeys.has(k));
  if (missing.length === 0) {
    return {
      name: 'env-drift',
      status: 'pass',
      message: `.env has all ${exampleKeys.size} key(s) declared in .env.example.`,
    };
  }
  return {
    name: 'env-drift',
    status: 'warn',
    message: `.env is missing ${missing.length} key(s) from .env.example: ${missing.join(', ')}.`,
    fix: 'Add the missing key(s) to .env (see .env.example for the expected names).',
  };
}
