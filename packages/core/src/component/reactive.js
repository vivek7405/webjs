import { tagOf } from '../registry.js';

export function defaultHasChanged(a, b) {
  return a !== b;
}

export function safeString(v) {
  try {
    return String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

export function warnFunctionReflection(host, propName, attrName) {
  if (typeof console === 'undefined' || !console.warn) return;
  const tag = tagOf(/** @type any */ (host.constructor)) || host.tagName?.toLowerCase() || 'unknown';
  console.warn(
    `[webjs] reflect:true property "${propName}" on <${tag}> holds a function `
    + `(or an array carrying one), which has no HTML attribute representation. `
    + `Removing "${attrName}" instead of stringifying it (a stringified function `
    + `writes its source into the page, so a server action's body would ship to `
    + `the browser). Pass a string, or drop reflect on this property.`
  );
}

export function warnUnserializableReflection(host, propName, attrName, detail) {
  if (typeof console === 'undefined' || !console.warn) return;
  const tag = tagOf(/** @type any */ (host.constructor)) || host.tagName?.toLowerCase() || 'unknown';
  console.warn(
    `[webjs] reflect:true property "${propName}" on <${tag}> holds a value `
    + `JSON.stringify cannot serialize (a cycle, a BigInt, or a throwing `
    + `toJSON), so it has no HTML attribute representation. Removing `
    + `"${attrName}" instead. Detail: ${detail}`
  );
}

/**
 * Helper to define properties with custom options.
 *
 * @param {any} [type]
 * @param {any} [opts]
 * @returns {any}
 */
export function prop(type, opts = {}) {
  if (type && typeof type === 'object' && !('call' in type)) {
    opts = type;
    type = undefined;
  }
  return { ...(type ? { type } : {}), ...opts };
}
