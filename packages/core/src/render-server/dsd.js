import { lookup, allTags } from '../registry.js';
import { stylesToString, isCSS } from '../css.js';
import { escapeAttr } from '../escape.js';
import { readAttributeValue, resolveAttributeProperty } from '../attribute-reader.js';
import { parse } from '../serialize.js';
import { unsafeHTML } from '../directives.js';
import {
  assertNotFunctionActionAttr, assertNotFunctionReflectedActionProp,
  assertIdentifiableAction, bindFormActionStartTag, isBoundFormAction, resolveFormActionId,
  assertConvergentBoundForm, assertSubmitterHasNoName, assertSubmitterHasNoValue,
  assertSubmitterHasNoFormAttribute,
  assertSingleSubmitterAction, bindSubmitterStartTag, parseStartTagAttrs,
  isSubmitterReflectedProp, FORM_ACTION_FIELD,
} from '../form-action.js';
import NAMED_ENTITIES, { LEGACY_NAMES } from '../html-entities.js';
import { render, defaultSSRErrorTemplate, browserMemberHint } from './template-renderer.js';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function isVoidElement(tag) {
  return VOID_ELEMENTS.has(tag.toLowerCase());
}

export function endOfComment(html, start) {
  let p = start + 4;
  if (html[p] === '>') return p + 1;
  if (html.startsWith('->', p)) return p + 2;
  while (p < html.length) {
    if (html.startsWith('-->', p)) return p + 3;
    if (html.startsWith('--!>', p)) return p + 4;
    p += 1;
  }
  return -1;
}

export function endOfScriptContent(html, from) {
  const re = /<!--|-->|<\/script(?=[\s/>])|<script(?=[\s/>])/gi;
  re.lastIndex = from;
  let escaped = false;
  let dbl = false;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = m[0];
    if (t === '<!--') {
      let q = m.index + 4;
      while (html[q] === '-') q += 1;
      if (html[q] === '>') { escaped = false; dbl = false; re.lastIndex = q + 1; }
      else if (!escaped) escaped = true;
    }
    else if (t === '-->') { escaped = false; dbl = false; }
    else if (t[1] === '/') {
      if (dbl) dbl = false;
      else return m.index;
    } else if (escaped) dbl = true;
  }
  return -1;
}

export function inertRanges(html) {
  /** @type {[number, number][]} */
  const ranges = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = endOfComment(html, lt);
      const stop = end === -1 ? n : end;
      ranges.push([lt, stop]);
      i = stop;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const close = html.indexOf('>', lt);
      const end = close === -1 ? n : close + 1;
      ranges.push([lt, end]);
      i = end;
      continue;
    }
    const name = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (!name) {
      if (html.startsWith('</', lt)) {
        const close = html.indexOf('>', lt);
        const end = close === -1 ? n : close + 1;
        ranges.push([lt, end]);
        i = end;
        continue;
      }
      i = lt + 1;
      continue;
    }
    let p = lt + 1;
    let quote = '';
    let expectValue = false;
    let inUnquoted = false;
    let selfClosing = false;
    while (p < n) {
      const c = html[p];
      const isSpace = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '>') {
        selfClosing = !inUnquoted && html[p - 1] === '/';
        p += 1;
        break;
      } else if (expectValue) {
        if (!isSpace) {
          if (c === '"' || c === "'") quote = c;
          else inUnquoted = true;
          expectValue = false;
        }
      } else if (inUnquoted) {
        if (isSpace) inUnquoted = false;
      } else if (c === '=') {
        expectValue = true;
      }
      p += 1;
    }
    if (p > lt + 1) ranges.push([lt + 1, p]);
    i = p;
    const tag = name[1].toLowerCase();
    const isClose = html[lt + 1] === '/';
    if (!isClose && !selfClosing && isTextOnlyTag(tag)) {
      let contentEnd;
      if (tag === 'plaintext') {
        contentEnd = n;
      } else if (tag === 'script') {
        const end = endOfScriptContent(html, p);
        contentEnd = end === -1 ? n : end;
      } else {
        const close = new RegExp(`</${tag}(?=[\\s/>])`, 'i').exec(html.slice(p));
        contentEnd = close ? p + close.index : n;
      }
      if (contentEnd > p) ranges.push([p, contentEnd]);
      i = contentEnd;
    }
  }
  return ranges;
}

export function inRanges(ranges, index) {
  for (const [start, end] of ranges) {
    if (start > index) return false;
    if (index < end) return true;
  }
  return false;
}

export function inertAt(ranges) {
  let cursor = 0;
  return (index) => {
    while (cursor < ranges.length && ranges[cursor][1] <= index) cursor += 1;
    if (cursor >= ranges.length) return false;
    return index >= ranges[cursor][0];
  };
}

export async function injectDSD(html, ctx, ancestors = [], dev) {
  html = await processSuspenseElements(html, ctx, ancestors, dev);
  const tags = allTags();
  if (!tags.length) return html;
  const sortedTags = [...tags].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `<(${sortedTags.map(escapeRegex).join('|')})(?=[\\s>/])((?:"[^"]*"|'[^']*'|[^>])*?)(/?)>`,
    'g'
  );
  /** @type {{start:number, end:number, text:string}[]} */
  const edits = [];
  const inert = inertRanges(html);
  const isInert = inertAt(inert);
  for (const m of html.matchAll(pattern)) {
    const [match, tag, attrs, selfClose] = m;
    const Cls = lookup(tag);
    if (!Cls) continue;
    if (isInert(m.index)) continue;
    if (ctx && ctx.usedComponents) ctx.usedComponents.add(tag);
    let opening = selfClose ? `<${tag}${attrs}>` : match;
    let instance = null;
    try {
      const isShadow = /** @type any */ (Cls).shadow === true;
      instance = new /** @type any */ (Cls)();
      instance.__ssrTag = tag;
      instance.__ssrAncestors = ancestors;
      const attrMap = parseAttrs(attrs);
      const propValues = consumePropAttrs(attrMap);
      const presentAttrNames = new Set(Object.keys(parseAttrs(attrs)).map((n) => n.toLowerCase()));
      seedServerAttrs(instance, attrMap);
      applyAttrsToInstance(instance, attrMap, Cls);
      for (const [k, v] of Object.entries(propValues)) instance[k] = v;
      let authoredInner = '';
      let closeEnd = m.index + match.length;
      if (!selfClose) {
        const innerStart = m.index + match.length;
        const closeIdx = findClosingTagInString(html, innerStart, tag, inert);
        if (closeIdx !== -1) {
          authoredInner = html.slice(innerStart, closeIdx);
          const closeRe = new RegExp(`</${escapeRegex(tag)}\\s*>`, 'i');
          const tail = html.slice(closeIdx);
          const closeMatch = closeRe.exec(tail);
          const closeLen = closeMatch ? closeMatch[0].length : `</${tag}>`.length;
          closeEnd = closeIdx + closeLen;
        } else {
          authoredInner = html.slice(innerStart);
          closeEnd = html.length;
        }
      }
      const partitioned = partitionAuthoredBySlot(authoredInner);
      if (typeof instance.performServerUpdate === 'function') instance.performServerUpdate();
      let tpl = instance.render ? instance.render() : '';
      if (tpl && typeof tpl.then === 'function') tpl = await tpl;
      opening = appendReflectedAttrs(opening, instance, presentAttrNames);
      if (!isShadow) opening = withHostMarker(opening);
      const rawInner = await render(tpl, ctx);

      if (isShadow) {
        const innerProcessed = await injectDSD(rawInner, ctx, [...ancestors, instance], dev);
        const rawStyles = /** @type any */ (Cls).styles;
        const styleList = Array.isArray(rawStyles) ? rawStyles : rawStyles && isCSS(rawStyles) ? [rawStyles] : [];
        const styleStr = stylesToString(styleList);
        edits.push({
          start: m.index,
          end: m.index + match.length,
          text: `${opening}<template shadowrootmode="open">${styleStr}${innerProcessed}</template>`,
        });
      } else {
        const renderedIsEmpty = rawInner.trim() === '';
        if (renderedIsEmpty) {
          edits.push({
            start: m.index,
            end: m.index + match.length,
            text: `${opening}<!--webjs-hydrate-->`,
          });
          continue;
        }
        const innerWithSlots = substituteSlotsInRender(rawInner, partitioned, tag);
        const innerProcessed = await injectDSD(innerWithSlots, ctx, [...ancestors, instance], dev);
        edits.push({
          start: m.index,
          end: closeEnd,
          text: `${opening}<!--webjs-hydrate-->${innerProcessed}</${tag}>`,
        });
      }
    } catch (e) {
      const hint = browserMemberHint(e);
      if (hint) {
        console.error(
          `[webjs] SSR failed for <${tag}>: ${hint} It was touched in the component's constructor or render(), which run during SSR. Move browser-only work to connectedCallback() or a lifecycle hook (firstUpdated/updated), which SSR never calls; seed first-paint defaults in the constructor only from server-known inputs (attributes / props).`,
          e,
        );
      } else {
        console.error(`[webjs] SSR failed for <${tag}>:`, e);
      }
      const err = e instanceof Error ? e : new Error(String(e));
      let errorInner = '';
      try {
        let errTpl;
        if (instance && typeof instance.renderError === 'function') {
          errTpl = instance.renderError(err);
        }
        if (errTpl === undefined) errTpl = defaultSSRErrorTemplate(tag, err, dev);
        errorInner = await render(errTpl, ctx);
        if (errorInner.trim()) {
          errorInner = await injectDSD(errorInner, ctx, instance ? [...ancestors, instance] : ancestors, dev);
        }
      } catch (renderErrorThrew) {
        console.error(`[webjs] renderError() for <${tag}> also threw:`, renderErrorThrew);
        errorInner = '';
      }
      let closeEnd = m.index + match.length;
      if (!selfClose) {
        const innerStart = m.index + match.length;
        const closeIdx = findClosingTagInString(html, innerStart, tag, inert);
        if (closeIdx !== -1) {
          const closeRe = new RegExp(`</${escapeRegex(tag)}\\s*>`, 'i');
          const cm = closeRe.exec(html.slice(closeIdx));
          closeEnd = closeIdx + (cm ? cm[0].length : `</${tag}>`.length);
        } else {
          closeEnd = html.length;
        }
      }
      const isShadowErr = /** @type any */ (Cls).shadow === true;
      if (!isShadowErr) opening = withHostMarker(opening);
      let text;
      if (isShadowErr) {
        const rawStyles = /** @type any */ (Cls).styles;
        const styleList = Array.isArray(rawStyles) ? rawStyles : rawStyles && isCSS(rawStyles) ? [rawStyles] : [];
        const styleStr = stylesToString(styleList);
        text = `${opening}<template shadowrootmode="open">${styleStr}${errorInner}</template>`;
      } else {
        text = `${opening}<!--webjs-hydrate-->${errorInner}</${tag}>`;
      }
      edits.push({ start: m.index, end: closeEnd, text });
    }
  }
  if (!edits.length) return html;

  edits.sort((a, b) => a.start - b.start);
  /** @type {{start:number, end:number, text:string}[]} */
  const filtered = [];
  let consumedTo = -1;
  for (const e of edits) {
    if (e.start >= consumedTo) {
      filtered.push(e);
      consumedTo = e.end;
    }
  }
  let out = html;
  for (let i = filtered.length - 1; i >= 0; i--) {
    const { start, end, text } = filtered[i];
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

export async function processSuspenseElements(html, ctx, ancestors = [], dev) {
  if (html.indexOf('<webjs-suspense') === -1) return html;
  const OPEN = /<webjs-suspense((?:"[^"]*"|'[^']*'|[^>])*?)>/i;
  const inert = inertRanges(html);
  const isInert = inertAt(inert);
  let consumed = 0;
  let result = '';
  let rest = html;
  for (let guard = 0; guard < 10000; guard++) {
    const m = OPEN.exec(rest);
    if (!m) {
      result += rest;
      break;
    }
    if (isInert(consumed + m.index)) {
      const skipTo = m.index + m[0].length;
      result += rest.slice(0, skipTo);
      rest = rest.slice(skipTo);
      consumed += skipTo;
      continue;
    }
    const openStart = m.index;
    const openEnd = m.index + m[0].length;
    result += rest.slice(0, openStart);
    const attrs = m[1] || '';
    const fbMatch = /data-webjs-fallback="([^"]*)"/i.exec(attrs);
    const fallbackHtml = fbMatch ? decodeAttrEntities(fbMatch[1]) : '';

    const shifted = [];
    for (const [s, e] of inert) {
      if (e <= consumed) continue;
      shifted.push([Math.max(0, s - consumed), e - consumed]);
    }
    const closeIdx = findClosingTagInString(rest, openEnd, 'webjs-suspense', shifted);
    let inner;
    let afterClose;
    if (closeIdx === -1) {
      inner = rest.slice(openEnd);
      afterClose = '';
    } else {
      inner = rest.slice(openEnd, closeIdx);
      const cm = /<\/webjs-suspense\s*>/i.exec(rest.slice(closeIdx));
      afterClose = rest.slice(closeIdx + (cm ? cm[0].length : '</webjs-suspense>'.length));
    }

    if (ctx) {
      const id = `s${ctx.nextId++}`;
      ctx.pending.push({ id, promise: Promise.resolve(unsafeHTML(inner)) });
      result += `<webjs-suspense id="${id}">${fallbackHtml}</webjs-suspense>`;
    } else {
      const innerProcessed = await injectDSD(inner, ctx, ancestors, dev);
      result += `<webjs-suspense>${innerProcessed}</webjs-suspense>`;
    }
    consumed += rest.length - afterClose.length;
    rest = afterClose;
  }
  return result;
}

export function findClosingTagInString(html, fromIndex, tagName, inert) {
  const esc = escapeRegex(tagName);
  const openRe = new RegExp(`<${esc}(?:[\\s>/])`, 'gi');
  const closeRe = new RegExp(`</${esc}\\s*>`, 'gi');
  const ranges = inert === undefined ? inertRanges(html) : inert;
  const next = (re) => {
    let m;
    while ((m = re.exec(html)) !== null) {
      if (ranges.length === 0 || !inRanges(ranges, m.index)) return m;
    }
    return null;
  };
  openRe.lastIndex = fromIndex;
  closeRe.lastIndex = fromIndex;
  let depth = 1;
  while (depth > 0) {
    const o = next(openRe);
    const c = next(closeRe);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      closeRe.lastIndex = o.index + 1;
    } else {
      depth--;
      if (depth === 0) return c.index;
      openRe.lastIndex = c.index + 1;
    }
  }
  return -1;
}

function extractSlotAttr(attrsRaw) {
  const m = /\bslot\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3] ?? '';
  return value === '' || value === 'default' ? null : value;
}

function partitionAuthoredBySlot(html) {
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

function appendStringToMap(map, key, value) {
  const existing = map.get(key);
  if (existing !== undefined) map.set(key, existing + value);
  else map.set(key, value);
}

function substituteSlotsInRender(rendered, partitioned, ownerTag) {
  const ownerAttr = ownerTag ? ` data-wj-slot-owner="${escapeAttr(ownerTag)}"` : '';
  const consumedNames = new Set();
  let result = '';
  let cursor = 0;
  const slotRe = /<slot((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/gi;
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

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isRawtextTag(tag) {
  return tag === 'script' || tag === 'style';
}

export function isRcdataTag(tag) {
  return tag === 'textarea' || tag === 'title';
}

export function isTextOnlyTag(tag) {
  return isRawtextTag(tag) || isRcdataTag(tag)
    || tag === 'iframe' || tag === 'xmp' || tag === 'noembed'
    || tag === 'noframes' || tag === 'plaintext';
}

export function parseAttrs(attrStr) {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

export function seedServerAttrs(instance, attrs) {
  if (!instance || typeof instance.setAttribute !== 'function') return;
  for (const [name, raw] of Object.entries(attrs)) {
    instance.setAttribute(name, decodeAttrEntities(raw));
  }
}

export function withHostMarker(opening) {
  if (/\sdata-wj-host(?=[\s>=])/i.test(opening)) return opening;
  return `${opening.slice(0, -1)} data-wj-host>`;
}

export function appendReflectedAttrs(opening, instance, presentAttrNames) {
  if (!instance || typeof instance.getAttributeNames !== 'function') return opening;
  let extra = '';
  for (const rawName of instance.getAttributeNames()) {
    const name = String(rawName).toLowerCase();
    if (presentAttrNames.has(name)) continue;
    const value = instance.getAttribute(rawName);
    extra += value === '' ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
  }
  if (!extra) return opening;
  return `${opening.slice(0, -1)}${extra}>`;
}

export function applyAttrsToInstance(instance, attrs, Cls) {
  for (const [sourceName, sourceValue] of Object.entries(attrs)) {
    const resolved = resolveAttributeProperty(Cls, sourceName.toLowerCase());
    if (resolved === undefined) continue;
    const { propName, def } = resolved;
    instance[propName] = readAttributeValue(def, decodeAttrEntities(sourceValue));
  }
}

export function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function kebabCase(s) {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

const C1_REPLACEMENTS = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

const CHAR_REF = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g;
const NAMED = new Map(Object.entries(NAMED_ENTITIES));
const LEGACY = new Set(LEGACY_NAMES);

export function decodeAttrEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(CHAR_REF, (match, dec, hex, name, semi, offset) => {
    if (dec !== undefined) return fromCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
    return decodeNamed(match, name, semi === ';', s[offset + match.length]);
  });
}

export function decodeNamed(match, name, hadSemi, nextChar) {
  if (hadSemi) {
    const cp = NAMED.get(name);
    return cp === undefined ? match : codePointsToString(cp);
  }
  if (!LEGACY.has(name)) return match;
  if (nextChar === '=') return match;
  return codePointsToString(NAMED.get(name));
}

export function codePointsToString(cp) {
  return typeof cp === 'number' ? String.fromCodePoint(cp) : String.fromCodePoint(...cp);
}

export function fromCodePoint(n) {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\uFFFD';
  if (C1_REPLACEMENTS[n] !== undefined) return String.fromCodePoint(C1_REPLACEMENTS[n]);
  return String.fromCodePoint(n);
}

export function consumePropAttrs(attrs) {
  const props = {};
  for (const key of Object.keys(attrs)) {
    if (!key.startsWith('data-webjs-prop-')) continue;
    const propName = camelCase(key.slice('data-webjs-prop-'.length));
    try {
      props[propName] = parse(decodeAttrEntities(attrs[key]));
    } catch {}
    delete attrs[key];
  }
  return props;
}
