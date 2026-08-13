import { escapeAttr } from '../escape.js';
import {
  endOfComment, escapeRegex, findClosingTagInString, inertAt, inertRanges, isVoidElement,
} from './html-scan.js';

/**
 * SSR light-DOM slot projection: partition a component's authored children by
 * their `slot=""` attribute, then substitute each `<slot>` in the rendered
 * template with the projected children or the authored fallback.
 *
 * String-level throughout, so it depends on `html-scan.js` and nothing else in
 * this directory.
 */

/**
 * Extract the `slot` attribute value from an attribute string. Returns
 * null when the attribute is absent.
 *
 * @param {string} attrsRaw
 * @returns {string | null}
 */
function extractSlotAttr(attrsRaw) {
  const m = /\bslot\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3] ?? '';
  // Per shadow DOM spec, slot="" (empty) and missing slot attribute both
  // route to the default slot. `default` is the framework's reserved alias
  // for it (#1015: the client record normalizes it identically, so both
  // sides agree end to end).
  return value === '' || value === 'default' ? null : value;
}

/**
 * Partition authored inner HTML by each top-level child's `slot=""`
 * attribute. Text nodes, comment nodes, and elements without `slot=""`
 * all route to the default-slot key (null).
 *
 * Returns a Map keyed by slot name (null for default) whose values are
 * the concatenated HTML strings for that slot in source order.
 *
 * @param {string} html
 * @returns {Map<string|null, string>}
 */
export function partitionAuthoredBySlot(html) {
  /** @type {Map<string|null, string>} */
  const groups = new Map();
  let defaultBuf = '';
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt === -1) {
      defaultBuf += html.slice(cursor);
      break;
    }
    if (lt > cursor) defaultBuf += html.slice(cursor, lt);
    const rest = html.slice(lt);
    if (rest.startsWith('<!--')) {
      // Find the comment's end the same way inertRanges does, rather than with
      // a bare `indexOf('-->')`. The two helpers both decide where a comment
      // stops, so a bare search makes them DISAGREE on the spec short forms
      // (`--!>`, `<!-->`, `<!--->`): this one would run past the real end and
      // swallow the slotted children that follow, silently routing a
      // `slot="head"` child into the default slot.
      const commentEnd = endOfComment(html, lt);
      if (commentEnd === -1) {
        defaultBuf += rest;
        cursor = html.length;
        break;
      }
      defaultBuf += html.slice(lt, commentEnd);
      cursor = commentEnd;
      continue;
    }
    if (rest.startsWith('<!') || rest.startsWith('</')) {
      const end = html.indexOf('>', lt);
      if (end === -1) {
        defaultBuf += rest;
        cursor = html.length;
        break;
      }
      defaultBuf += html.slice(lt, end + 1);
      cursor = end + 1;
      continue;
    }
    const tagMatch = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/.exec(rest);
    if (!tagMatch) {
      defaultBuf += '<';
      cursor = lt + 1;
      continue;
    }
    const [tagFull, tagName, attrsRaw, selfCloseSlash] = tagMatch;
    const lower = tagName.toLowerCase();
    const isSelfClose = !!selfCloseSlash || isVoidElement(lower);
    const slotAttr = extractSlotAttr(attrsRaw);
    let elemEnd;
    if (isSelfClose) {
      elemEnd = lt + tagFull.length;
    } else {
      const innerStart = lt + tagFull.length;
      const closeIdx = findClosingTagInString(html, innerStart, lower);
      if (closeIdx === -1) {
        // Unclosed element. Take to end of html.
        const elementHTML = html.slice(lt);
        if (slotAttr !== null) appendStringToMap(groups, slotAttr, elementHTML);
        else defaultBuf += elementHTML;
        cursor = html.length;
        continue;
      }
      const closeRe = new RegExp(`</${escapeRegex(lower)}\\s*>`, 'i');
      const tail = html.slice(closeIdx);
      const closeMatch = closeRe.exec(tail);
      const closeLen = closeMatch ? closeMatch[0].length : `</${lower}>`.length;
      elemEnd = closeIdx + closeLen;
    }
    const elementHTML = html.slice(lt, elemEnd);
    if (slotAttr !== null) appendStringToMap(groups, slotAttr, elementHTML);
    else defaultBuf += elementHTML;
    cursor = elemEnd;
  }
  if (defaultBuf.length > 0) groups.set(null, defaultBuf);
  return groups;
}

/** Append a string to a Map<K, string>, concatenating if the key exists. */
function appendStringToMap(map, key, value) {
  const existing = map.get(key);
  if (existing !== undefined) map.set(key, existing + value);
  else map.set(key, value);
}

/**
 * Substitute every `<slot>` tag in `rendered` with a framework-marked
 * `<slot data-webjs-light data-projection="actual|fallback">` element
 * carrying either the projected children for that slot (from
 * `partitioned`) or the slot's authored fallback content. Multiple
 * slots with the same name follow the first-wins rule per spec; later
 * same-named slots fall back regardless of available projection.
 *
 * The `ownerTag` (the tag of the component whose template rendered these
 * slots) is emitted as `data-wj-slot-owner` so the client resolves template
 * ownership on hydration the same way the client renderer stamps SLOT_OWNER,
 * which is what makes a FORWARDED slot (rendered by this component but nested
 * inside a child) route to this component and not the child (#1023).
 *
 * @param {string} rendered
 * @param {Map<string|null, string>} partitioned
 * @param {string} ownerTag
 * @returns {string}
 */
export function substituteSlotsInRender(rendered, partitioned, ownerTag) {
  const ownerAttr = ownerTag ? ` data-wj-slot-owner="${escapeAttr(ownerTag)}"` : '';
  /** @type {Set<string|null>} */
  const consumedNames = new Set();
  let result = '';
  let cursor = 0;
  const slotRe = /<slot((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/gi;
  // A `<slot>` written inside a comment is documentation, not a slot (#1128).
  // Substituting one is worse here than in the element walk: a commented slot
  // has no `</slot>`, so the fallback scan below swallows the rest of the
  // template, the component's REAL slot is never substituted, and the authored
  // children are dropped from the page entirely.
  const inert = inertRanges(rendered);
  const isInert = inertAt(inert);
  let m;
  while ((m = slotRe.exec(rendered)) !== null) {
    if (isInert(m.index)) continue;
    result += rendered.slice(cursor, m.index);
    const [fullOpen, attrsRaw, selfCloseSlash] = m;
    const isSelfClose = !!selfCloseSlash;
    const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw);
    const name = nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3]) : null;
    // Strip the `name` attribute from the carried-through attribute
    // string so we can re-add it (with escaping) on the framework slot.
    const otherAttrs = attrsRaw.replace(/\bname\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '').trim();
    let fallback = '';
    let totalEnd;
    if (isSelfClose) {
      totalEnd = m.index + fullOpen.length;
    } else {
      const innerStart = m.index + fullOpen.length;
      const closeIdx = findClosingTagInString(rendered, innerStart, 'slot', inert);
      if (closeIdx === -1) {
        fallback = rendered.slice(innerStart);
        totalEnd = rendered.length;
      } else {
        fallback = rendered.slice(innerStart, closeIdx);
        const closeRe = /<\/slot\s*>/i;
        const tail = rendered.slice(closeIdx);
        const closeMatch = closeRe.exec(tail);
        const closeLen = closeMatch ? closeMatch[0].length : '</slot>'.length;
        totalEnd = closeIdx + closeLen;
      }
    }
    // `default` and `''` are the reserved aliases for the default slot
    // (#1015), matching the client's keyOfName exactly: the LOOKUP key
    // normalizes, while the emitted name attribute stays as authored so the
    // output bytes are unchanged for every other app.
    const slotKey = name === 'default' || name === '' ? null : name;
    const projected = partitioned.get(slotKey);
    const nameAttr = name !== null ? ` name="${escapeAttr(name)}"` : '';
    const extraAttrs = otherAttrs ? ` ${otherAttrs}` : '';
    if (projected !== undefined && !consumedNames.has(slotKey)) {
      consumedNames.add(slotKey);
      result += `<slot data-webjs-light data-projection="actual"${ownerAttr}${nameAttr}${extraAttrs}>${projected}</slot>`;
    } else {
      result += `<slot data-webjs-light data-projection="fallback"${ownerAttr}${nameAttr}${extraAttrs}>${fallback}</slot>`;
    }
    cursor = totalEnd;
    slotRe.lastIndex = totalEnd;
  }
  result += rendered.slice(cursor);
  return result;
}
