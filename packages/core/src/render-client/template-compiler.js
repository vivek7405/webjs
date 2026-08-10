import { isTemplate, MARKER } from '../html.js';
import { BINDING_PREFIXES, isBindingPrefix } from '../binding-prefixes.js';
import { isSubmitterReflectedProp } from '../form-action.js';
import { LIGHT_SLOT_ATTR } from '../slot.js';

export const templateCache = new WeakMap();
export const submitterActionBindings = new WeakMap();
export const INSTANCE = Symbol.for('webjs.instance');

export function compile(tr) {
  const { strings } = tr;
  let cached = templateCache.get(strings);
  if (cached) return cached;

  /** @type {any[]} */
  const parts = [];
  let html = '';
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  let mixedAttr = null;
  let currentTag = '';
  let rawTail = '';

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
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; }
          else if (/[a-zA-Z]/.test(c)) { state = 'tag-name'; currentTag = c.toLowerCase(); }
          else state = 'text';
          break;
        case 'bang-1':
          html += c;
          state = c === '-' ? 'bang-dash' : 'tag-name';
          break;
        case 'bang-dash':
          html += c;
          if (c === '-') { state = 'comment'; commentDashes = 0; }
          else state = 'tag-name';
          break;
        case 'comment':
          html += c;
          if (c === '-') commentDashes += 1;
          else if (c === '>' && commentDashes >= 2) { state = 'text'; commentDashes = 0; }
          else commentDashes = 0;
          break;
        case 'tag-name':
          html += c;
          if (c === '>') {
            state = (currentTag === 'script' || currentTag === 'style') ? 'rawtext' : 'text';
            if (state === 'rawtext') rawTail = '';
          } else if (/\s/.test(c)) state = 'in-tag';
          else currentTag += c.toLowerCase();
          break;
        case 'in-tag':
          html += c;
          if (c === '>') {
            state = (currentTag === 'script' || currentTag === 'style') ? 'rawtext' : 'text';
            if (state === 'rawtext') rawTail = '';
          } else if (!/\s/.test(c) && c !== '/') {
            state = 'attr-name';
            attrName = c;
            attrStart = html.length - 1;
          }
          break;
        case 'rawtext':
          html += c;
          rawTail = (rawTail + c.toLowerCase()).slice(-9);
          if (rawTail.endsWith('</script>') || rawTail.endsWith('</style>')) {
            state = 'text';
            rawTail = '';
            currentTag = '';
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
        case 'skip-attr':
          if (c === attrQuote) {
            if (mixedAttr) {
              const idx0 = mixedAttr.firstPartIdx;
              const group = [];
              for (let k = idx0; k < parts.length; k++) {
                if (parts[k].kind === 'noop' || parts[k].kind === 'attr-mixed') group.push(k);
              }
              const statics = [];
              const s0 = strings[group[0]];
              const qp = s0.lastIndexOf(attrQuote);
              statics.push(qp >= 0 ? s0.slice(qp + 1) : s0);
              for (let k = 1; k < group.length; k++) {
                statics.push(strings[group[k]]);
              }
              const sLast = strings[group[group.length - 1] + 1];
              const eq = sLast.indexOf(attrQuote);
              statics.push(eq >= 0 ? sLast.slice(0, eq) : sLast);

              parts[idx0] = {
                kind: 'attr-mixed',
                path: [],
                name: mixedAttr.name,
                statics,
                group,
              };
              for (let m = 1; m < group.length; m++) {
                parts[group[m]] = { kind: 'noop', path: [], mixedAnchor: idx0 };
              }
              mixedAttr = null;
            }
            state = 'in-tag';
            attrName = '';
          }
          break;
      }
    }

    if (i < strings.length - 1) {
      const partIdx = parts.length;
      if (state === 'comment') {
        commentDashes = 0;
        parts.push({ kind: 'noop', path: [] });
        continue;
      }
      if (state === 'rawtext') {
        rawTail = '';
        parts.push({ kind: 'noop', path: [] });
        continue;
      }
      if (state === 'text') {
        html += `<!--${MARKER}${partIdx}-->`;
        parts.push({ kind: 'child', path: [] });
      } else if (state === 'in-tag') {
        const sentinel = `data-${MARKER}${partIdx}`;
        html += `${sentinel}=""`;
        parts.push({ kind: 'element', path: [] });
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        if (isBindingPrefix(prefix)) {
          html = html.slice(0, attrStart);
          const kind = BINDING_PREFIXES[prefix];
          const sentinel = `data-${MARKER}${partIdx}`;
          html += `${sentinel}=""`;
          parts.push({ kind, path: [], name });
        } else {
          html = html.slice(0, attrStart);
          const sentinel = `data-${MARKER}${partIdx}`;
          html += `${sentinel}=""`;
          parts.push({ kind: 'attr', path: [], name: attrName });
        }
        state = 'in-tag';
        attrName = '';
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
        html = html.slice(0, attrStart);
        const sentinel = `data-${MARKER}${partIdx}`;
        html += `${sentinel}=""`;
        mixedAttr = { name: attrName, firstPartIdx: partIdx };
        parts.push({ kind: 'noop', path: [] });
        state = 'skip-attr';
      } else if (state === 'skip-attr') {
        parts.push({ kind: 'noop', path: [] });
      }
    }
  }

  const templateEl = document.createElement('template');
  templateEl.innerHTML = html;

  discoverSlots(templateEl.content, parts);
  const formActions = assignPaths(templateEl.content, parts);

  cached = { templateEl, parts, formActions };
  templateCache.set(strings, cached);
  return cached;
}

function discoverSlots(root, parts) {
  const slots = root.querySelectorAll('slot');
  for (const slot of slots) {
    slot.setAttribute(LIGHT_SLOT_ATTR, '');
    const partIdx = parts.length;
    slot.setAttribute(`data-${MARKER}${partIdx}`, '');
    parts.push({ kind: 'slot', path: [] });
  }
}

function assignPaths(root, parts) {
  /** @type {number[]} */
  const path = [];
  /** @type {any[]} */
  const formActions = [];

  function visit(node) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      path.push(i);
      if (child.nodeType === 8) {
        const txt = /** @type Comment */ (child).data;
        if (txt.startsWith(MARKER)) {
          const idx = Number(txt.slice(MARKER.length));
          if (parts[idx] && parts[idx].kind === 'child') {
            parts[idx].path = path.slice();
          }
        }
      } else if (child.nodeType === 1) {
        const el = /** @type Element */ (child);
        const toRemove = [];
        const onEl = [];
        for (const attr of el.attributes) {
          if (attr.name.startsWith(`data-${MARKER}`)) {
            const idx = Number(attr.name.slice(`data-${MARKER}`.length));
            if (parts[idx] && parts[idx].kind !== 'child') {
              parts[idx].path = path.slice();
              onEl.push({ idx, kind: parts[idx].kind, name: parts[idx].name || '' });
            }
            toRemove.push(attr.name);
          }
        }

        if (el.localName === 'form' || el.localName === 'button' || el.localName === 'input') {
          const rec = buildFormActionRecord(el, onEl, parts);
          if (rec) formActions.push(rec);
        }

        for (const name of toRemove) {
          el.removeAttribute(name);
        }
        visit(child);
      }
      path.pop();
    }
  }

  visit(root);
  return formActions.length ? formActions : null;
}

function buildFormActionRecord(el, onEl, parts) {
  const isForm = el.localName === 'form';
  const targetAttr = isForm ? 'action' : 'formaction';
  const methodAttr = isForm ? 'method' : 'formmethod';
  const enctypeAttr = isForm ? 'enctype' : 'formenctype';
  const actionParts = onEl.filter((p) => p.kind === 'attr' && p.name.toLowerCase() === targetAttr);
  if (!actionParts.length) return null;

  const methodParts = [];
  const enctypeParts = [];
  const propAttrs = [];
  const nameParts = isForm ? [] : onEl
    .filter((p) => p.name.toLowerCase() === 'name'
      && (p.kind === 'attr' || p.kind === 'attr-mixed' || p.kind === 'bool'))
    .map((p) => ({ i: p.idx, kind: p.kind }));
  const authoredName = !isForm && el.hasAttribute('name');
  const authoredForm = !isForm && el.hasAttribute('form');
  const authoredValue = !isForm && el.hasAttribute('value');
  const valueParts = isForm ? [] : onEl
    .filter((p) => p.name.toLowerCase() === 'value'
      && (p.kind === 'attr' || p.kind === 'attr-mixed' || p.kind === 'bool'))
    .map((p) => ({ i: p.idx, kind: p.kind }));

  for (const p of onEl) {
    const name = String(p.name).toLowerCase();
    if (p.kind === 'prop') {
      if (isForm) {
        if (name === 'method' || name === 'enctype' || name === 'encoding') propAttrs.push(p.name);
      } else if (isSubmitterReflectedProp(name)) {
        propAttrs.push(p.name);
      }
      continue;
    }
    if (name !== methodAttr && name !== enctypeAttr) continue;
    if (p.kind !== 'attr' && p.kind !== 'attr-mixed' && p.kind !== 'bool') continue;
    const d = /** @type any */ (parts[p.idx]);
    const entry = { i: p.idx, kind: p.kind };
    if (p.kind === 'attr-mixed') { entry.statics = d.statics || []; entry.group = d.group || []; }
    (name === methodAttr ? methodParts : enctypeParts).push(entry);
  }

  return {
    isForm,
    tag: el.localName,
    actionIdxs: actionParts.map((p) => p.idx),
    duplicateAction: actionParts.length > 1,
    staticAction: el.getAttribute(targetAttr) != null,
    authoredName,
    authoredValue,
    authoredForm,
    propAttrs,
    nameParts,
    valueParts,
    staticMethod: el.getAttribute(methodAttr),
    staticEnctype: el.getAttribute(enctypeAttr),
    methodParts,
    enctypeParts,
  };
}
