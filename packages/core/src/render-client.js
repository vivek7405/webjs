import { isTemplate, MARKER } from './html.js';
import { escapeAttr } from './escape.js';

/**
 * Render a value (TemplateResult or primitive) into a DOM container,
 * replacing existing children.
 *
 * This is a simple, correct-but-not-optimised renderer: every call
 * rebuilds the DOM from scratch. Good enough for v1; Lit-style
 * part-diffing can be bolted on later without touching public API.
 *
 * @param {unknown} value
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
export function render(value, container) {
  // @ts-ignore
  container.replaceChildren();
  appendValue(value, container);
}

/**
 * @param {unknown} value
 * @param {ParentNode} container
 */
function appendValue(value, container) {
  if (value == null || value === false || value === true) return;
  if (Array.isArray(value)) {
    for (const v of value) appendValue(v, container);
    return;
  }
  if (isTemplate(value)) {
    appendTemplate(/** @type any */ (value), container);
    return;
  }
  container.appendChild(document.createTextNode(String(value)));
}

/**
 * @param {import('./html.js').TemplateResult} tr
 * @param {ParentNode} container
 */
function appendTemplate(tr, container) {
  const { strings, values } = tr;
  /** @type {{kind: 'text'|'event'|'prop'|'bool', idx: number, name?: string}[]} */
  const parts = [];
  let html = '';
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      switch (state) {
        case 'text':
          html += c;
          if (c === '<') state = 'tag-open';
          break;
        case 'tag-open':
          html += c;
          if (c === '!' || c === '/' || /[a-zA-Z]/.test(c)) state = 'tag-name';
          else state = 'text';
          break;
        case 'tag-name':
          html += c;
          if (c === '>') state = 'text';
          else if (/\s/.test(c)) state = 'in-tag';
          break;
        case 'in-tag':
          html += c;
          if (c === '>') state = 'text';
          else if (!/\s/.test(c) && c !== '/') {
            state = 'attr-name';
            attrName = c;
            attrStart = html.length - 1;
          }
          break;
        case 'attr-name':
          if (c === '=') { state = 'after-eq'; html += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; html += c; }
          else if (c === '>') { state = 'text'; attrName = ''; html += c; }
          else { attrName += c; html += c; }
          break;
        case 'after-eq':
          if (c === '"' || c === "'") { state = 'attr-quoted'; attrQuote = c; html += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; html += c; }
          else if (c === '>') { state = 'text'; attrName = ''; html += c; }
          else { state = 'attr-unquoted'; html += c; }
          break;
        case 'attr-unquoted':
          if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; html += c; }
          else if (c === '>') { state = 'text'; attrName = ''; html += c; }
          else html += c;
          break;
        case 'attr-quoted':
          html += c;
          if (c === attrQuote) { state = 'in-tag'; attrName = ''; }
          break;
      }
    }

    if (i < values.length) {
      if (state === 'text') {
        html += `<!--${MARKER}${parts.length}-->`;
        parts.push({ kind: 'text', idx: i });
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        const idx = parts.length;
        if (prefix === '@') {
          html = html.slice(0, attrStart) + `data-${MARKER}ev-${name}="${idx}"`;
          parts.push({ kind: 'event', idx: i, name });
          state = 'in-tag';
          attrName = '';
        } else if (prefix === '.') {
          html = html.slice(0, attrStart) + `data-${MARKER}p-${name.toLowerCase()}="${idx}"`;
          parts.push({ kind: 'prop', idx: i, name });
          state = 'in-tag';
          attrName = '';
        } else if (prefix === '?') {
          html = html.slice(0, attrStart);
          if (values[i]) html += `${name}=""`;
          state = 'in-tag';
          attrName = '';
        } else {
          html += `"${escapeAttr(String(values[i] ?? ''))}"`;
          state = 'in-tag';
          attrName = '';
        }
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
        html += escapeAttr(String(values[i] ?? ''));
      }
    }
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const frag = tpl.content;
  applyParts(frag, parts, values);
  // @ts-ignore
  container.appendChild(frag);
}

/**
 * Walk the freshly-parsed fragment and materialise each part:
 * replace comment markers with rendered values, wire up events,
 * assign props, and strip the marker attributes.
 *
 * @param {DocumentFragment} frag
 * @param {{kind: string, idx: number, name?: string}[]} parts
 * @param {unknown[]} values
 */
function applyParts(frag, parts, values) {
  // Text parts: find <!--w$N--> comments
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_COMMENT);
  /** @type {Comment[]} */
  const comments = [];
  let n;
  while ((n = walker.nextNode())) comments.push(/** @type Comment */ (n));
  for (const comment of comments) {
    const txt = comment.nodeValue || '';
    if (!txt.startsWith(MARKER)) continue;
    const partIdx = Number(txt.slice(MARKER.length));
    const part = parts[partIdx];
    if (!part || part.kind !== 'text') continue;
    const value = values[part.idx];
    const parent = /** @type ParentNode */ (comment.parentNode);
    if (!parent) continue;
    const holder = document.createDocumentFragment();
    appendValue(value, holder);
    parent.replaceChild(holder, comment);
  }

  // Event + prop parts: look for our data-* marker attrs.
  const elems = frag.querySelectorAll('*');
  for (const el of elems) {
    /** @type {Attr[]} */
    const toRemove = [];
    for (const attr of el.attributes) {
      if (attr.name.startsWith(`data-${MARKER}ev-`)) {
        const evName = attr.name.slice(`data-${MARKER}ev-`.length);
        const partIdx = Number(attr.value);
        const part = parts[partIdx];
        if (part && part.kind === 'event') {
          const handler = /** @type any */ (values[part.idx]);
          if (typeof handler === 'function') {
            el.addEventListener(evName, handler);
          }
        }
        toRemove.push(attr);
      } else if (attr.name.startsWith(`data-${MARKER}p-`)) {
        const propName = attr.name.slice(`data-${MARKER}p-`.length);
        const partIdx = Number(attr.value);
        const part = parts[partIdx];
        if (part && part.kind === 'prop' && part.name) {
          // @ts-ignore
          el[part.name] = values[part.idx];
        }
        toRemove.push(attr);
      }
    }
    for (const a of toRemove) el.removeAttributeNode(a);
  }
}
