/**
 * A test that picks its own port must not be able to pick one `fetch()` refuses.
 *
 * The dev-server tests derive a port as `base + (process.pid % n)` so a leftover
 * socket from a prior run lingering in TIME_WAIT cannot break the next one. The
 * hazard is that the resulting RANGE can contain a port on the WHATWG Fetch
 * bad-ports list, and `fetch()` rejects those before it opens a socket, with a
 * `TypeError: fetch failed` whose cause is the bare string "bad port".
 *
 * That happened. `dev-public-before-warm.mjs` was based at 10000 over `% 256`,
 * so its range covered 10080, the last entry on that list, and any run whose pid
 * was 80 mod 256 failed every request in the file (#1461). Two things made it
 * expensive out of proportion to the typo:
 *
 *   - It is DETERMINISTIC given the pid, not timing-dependent, so a re-run
 *     almost always went green and it read as flake for as long as it survived.
 *   - The symptom points nowhere near the cause. `dev-morph-verdict.mjs` had the
 *     same exposure and fails as "dev server never came up" while its own
 *     captured log says `webjs dev server ready on http://localhost:10080`. The
 *     server is fine; the poll simply cannot reach it.
 *
 * So this guards the CLASS rather than the two files, because the fix to those
 * two protects only them and the next dev-server test starts from a copy of
 * whichever neighbour was nearest.
 *
 * It reads the source rather than importing it: these modules spawn a real dev
 * server on import, so evaluating them here would cost minutes and, at the wrong
 * pid, would be the very failure being guarded against.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_DIR = join(ROOT, 'test');

/**
 * The WHATWG Fetch "bad ports", which every fetch() implementation refuses.
 * https://fetch.spec.whatwg.org/#bad-port
 *
 * The whole list is here rather than only 10080, the one that bit, because a
 * future test is free to base itself anywhere and the ports below 1024 are just
 * as unusable. 10080 is the HIGHEST entry, so any range above it is permanently
 * safe, which is the rule the two fixed files were moved to satisfy.
 */
const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/** `const PORT = 9750 + (process.pid % 240);` and any spelling of the same. */
const PID_PORT = /(\w*PORT\w*)\s*=\s*(\d+)\s*\+\s*\(\s*process\.pid\s*%\s*(\d+)\s*\)/g;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'fixtures') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(mjs|js)$/.test(entry)) yield full;
  }
}

const found = [];
for (const file of sourceFiles(TEST_DIR)) {
  const src = readFileSync(file, 'utf8');
  for (const [, name, base, mod] of src.matchAll(PID_PORT)) {
    found.push({
      file: relative(ROOT, file),
      name,
      lo: Number(base),
      hi: Number(base) + Number(mod) - 1,
    });
  }
}

test('a pid-derived test port cannot land on a fetch-blocked port', () => {
  const offenders = found.flatMap((p) => {
    const hits = [...BAD_PORTS].filter((bad) => bad >= p.lo && bad <= p.hi);
    return hits.length ? [`${p.file} (${p.name} covers ${p.lo}-${p.hi}, includes ${hits.join(', ')})`] : [];
  });
  assert.deepEqual(
    offenders,
    [],
    `These ranges can produce a port fetch() refuses, so the file fails for a reason\n` +
      `unrelated to what it tests, on the pids that land there:\n  ${offenders.join('\n  ')}\n\n` +
      `Re-base above 10080, the highest bad port, and keep the range clear of the others.`,
  );
});

test('the guard is actually reading the port declarations', () => {
  // Without this the suite above passes VACUOUSLY the moment the idiom changes
  // spelling or the regex drifts, and a guard that cannot fail is worse than no
  // guard, because it reads as coverage. Exactly the failure the og-card fit
  // pass shipped with: its condition could never be false either.
  assert.ok(
    found.length >= 6,
    `Expected to find the pid-derived port declarations, found ${found.length}. ` +
      `If the idiom moved to a shared helper, point this guard at it.`,
  );
});
