import { digestBase64 } from '../crypto-utils.js';

/**
 * Compute the SHA-384 SRI hash for a bundle body.
 *
 * @param {string | ArrayBufferView | ArrayBuffer} body
 * @returns {Promise<string>}
 */
export async function sha384Integrity(body) {
  return `sha384-${await digestBase64('SHA-384', body)}`;
}

/**
 * Parse a version string to [major, minor, patch] numeric triple.
 *
 * @param {string} v
 * @returns {[number, number, number] | null}
 */
export function parseSemver(v) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v == null ? '' : v));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/**
 * Compare two [major, minor, patch] triples.
 *
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
export function cmpSemver(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Does `version` satisfy the npm `range`?
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean | null}
 */
export function satisfiesSemverRange(version, range) {
  const v = parseSemver(version);
  if (!v) return null;
  const r = String(range == null ? '' : range).trim();
  if (r === '' || r === '*' || r === 'x' || r === 'X' || r === 'latest') return true;
  if (r.startsWith('workspace:')) return true;
  if (r.includes('||')) {
    let sawUnknown = false;
    for (const clause of r.split('||')) {
      const res = satisfiesSemverRange(version, clause.trim());
      if (res === true) return true;
      if (res === null) sawUnknown = true;
    }
    return sawUnknown ? null : false;
  }
  if (/\s/.test(r)) {
    if (/\s-\s/.test(r)) return null;
    let result = true;
    for (const part of r.split(/\s+/)) {
      if (!part) continue;
      const res = satisfiesSemverRange(version, part);
      if (res === null) return null;
      if (res === false) result = false;
    }
    return result;
  }
  const cmpMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(r);
  if (cmpMatch) {
    const op = cmpMatch[1];
    const bound = parseSemver(cmpMatch[2]);
    if (!bound) return null;
    const c = cmpSemver(v, bound);
    switch (op) {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      case '=': return c === 0;
    }
  }
  if (r.startsWith('^')) {
    const b = parseSemver(r.slice(1));
    if (!b) return null;
    if (cmpSemver(v, b) < 0) return false;
    if (b[0] > 0) return v[0] === b[0];
    if (b[1] > 0) return v[0] === 0 && v[1] === b[1];
    return v[0] === 0 && v[1] === 0 && v[2] === b[2];
  }
  if (r.startsWith('~')) {
    const raw = r.slice(1);
    const b = parseSemver(raw);
    if (!b) return null;
    if (cmpSemver(v, b) < 0) return false;
    const namedMinor = /^\d+\.\d+/.test(raw);
    return namedMinor ? v[0] === b[0] && v[1] === b[1] : v[0] === b[0];
  }
  if (/^\d+(\.(\d+|[xX*])){0,2}$/.test(r) && /[xX*]/.test(r)) {
    const segs = r.split('.');
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s === 'x' || s === 'X' || s === '*') break;
      if (Number(s) !== v[i]) return false;
    }
    return true;
  }
  const exact = r.startsWith('v') ? r.slice(1) : r;
  if (/^\d+(\.\d+){0,2}$/.test(exact)) {
    const b = parseSemver(exact);
    if (!b) return null;
    const segs = exact.split('.').length;
    for (let i = 0; i < segs; i++) if (v[i] !== b[i]) return false;
    return true;
  }
  return null;
}
