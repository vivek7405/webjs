import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripJsonc } from '../util.js';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 2, tsconfig erasableSyntaxOnly. PASS when `true`; WARN when no tsconfig
 * (a JS-only app legitimately has none) or the file is unparseable; HARD-FAIL
 * when the file EXISTS but the flag is missing/false (non-erasable TS 500s at
 * strip time).
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
export async function checkTsconfig(appDir) {
  const path = join(appDir, 'tsconfig.json');
  if (!existsSync(path)) {
    return {
      name: 'tsconfig-erasable',
      status: 'warn',
      message: 'No tsconfig.json found. A JS-only app needs none; a TypeScript app requires one.',
      fix: 'If this app uses TypeScript, add a tsconfig.json with "erasableSyntaxOnly": true.',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripJsonc(await readFile(path, 'utf8')));
  } catch {
    return {
      name: 'tsconfig-erasable',
      status: 'warn',
      message: 'tsconfig.json could not be parsed (even after stripping comments + trailing commas).',
      fix: 'Fix the tsconfig.json syntax, then ensure "compilerOptions.erasableSyntaxOnly": true.',
    };
  }
  const flag = parsed?.compilerOptions?.erasableSyntaxOnly;
  if (flag === true) {
    return {
      name: 'tsconfig-erasable',
      status: 'pass',
      message: 'tsconfig.json sets "erasableSyntaxOnly": true.',
    };
  }
  return {
    name: 'tsconfig-erasable',
    status: 'fail',
    message:
      'tsconfig.json is missing "compilerOptions.erasableSyntaxOnly": true. ' +
      'Non-erasable TypeScript (enum, namespace, parameter properties, ...) 500s at strip time.',
    fix: 'Set "compilerOptions": { "erasableSyntaxOnly": true } in tsconfig.json.',
  };
}
