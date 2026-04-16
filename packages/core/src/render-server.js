import { isTemplate } from './html.js';
import { escapeText, escapeAttr } from './escape.js';
import { lookup, lookupModuleUrl, allTags } from './registry.js';
import { stylesToString, isCSS } from './css.js';
import { isRepeat } from './repeat.js';
import { isSuspense } from './suspense.js';

/**
 * Render a TemplateResult (or any renderable value) to an HTML string.
 *
 * Async by design: template holes may be Promises, components' `render()`
 * methods may be async, and data-fetching inside nested components is
 * awaited before the final string is emitted.
 *
 * If `opts.suspenseCtx` is provided, Suspense boundaries encountered during
 * the render will push `{ id, promise }` into `opts.suspenseCtx.pending`
 * and their fallback HTML is emitted immediately. The caller is responsible
 * for streaming each resolved promise afterwards. Without a suspenseCtx,
 * Suspense still works but we fall back to emitting only the fallback
 * (the promise is dropped — appropriate for static pre-render).
 *
 * @typedef {{ pending: {id: string, promise: Promise<unknown>}[], nextId: number }} SuspenseCtx
 *
 * @param {unknown} value
 * @param {{ ssr?: boolean, suspenseCtx?: SuspenseCtx }} [opts]
 * @returns {Promise<string>}
 */
export async function renderToString(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  const html = await render(value, ctx);
  return opts && opts.ssr === false ? html : await injectDSD(html, ctx);
}

/**
 * @param {unknown} value
 * @param {SuspenseCtx} [ctx]
 * @returns {Promise<string>}
 */
async function render(value, ctx) {
  if (value == null || value === false || value === true) return '';
  if (value && typeof /** @type any */ (value).then === 'function') {
    value = await value;
    return render(value, ctx);
  }
  if (Array.isArray(value)) {
    const parts = await Promise.all(value.map((v) => render(v, ctx)));
    return parts.join('');
  }
  if (isRepeat(value)) {
    const r = /** @type any */ (value);
    const parts = await Promise.all(r.items.map((it, i) => render(r.templateFn(it, i), ctx)));
    return parts.join('');
  }
  if (isSuspense(value)) {
    const s = /** @type any */ (value);
    const fallback = await render(s.fallback, ctx);
    if (ctx) {
      const id = `s${ctx.nextId++}`;
      ctx.pending.push({ id, promise: Promise.resolve(s.children) });
      return `<webjs-boundary id="${id}">${fallback}</webjs-boundary>`;
    }
    return fallback;
  }
  if (isTemplate(value)) return renderTemplate(/** @type any */ (value), ctx);
  return escapeText(String(value));
}

/**
 * @param {import('./html.js').TemplateResult} tr
 * @param {SuspenseCtx} [ctx]
 * @returns {Promise<string>}
 */
async function renderTemplate(tr, ctx) {
  const { strings, values } = tr;
  let out = '';
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  let currentTag = '';   // lowercased tag name currently being parsed
  let rawTail = '';      // rolling lowercased tail, tracks </script>/</style>

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      switch (state) {
        case 'text':
          out += c;
          if (c === '<') state = 'tag-open';
          break;
        case 'tag-open':
          out += c;
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; }
          else if (/[a-zA-Z]/.test(c)) { state = 'tag-name'; currentTag = c.toLowerCase(); }
          else state = 'text';
          break;
        case 'bang-1':
          out += c;
          state = c === '-' ? 'bang-dash' : 'tag-name';
          break;
        case 'bang-dash':
          out += c;
          if (c === '-') { state = 'comment'; commentDashes = 0; }
          else state = 'tag-name';
          break;
        case 'comment':
          out += c;
          if (c === '-') commentDashes += 1;
          else if (c === '>' && commentDashes >= 2) { state = 'text'; commentDashes = 0; }
          else commentDashes = 0;
          break;
        case 'tag-name':
          out += c;
          if (c === '>') {
            state = isRawtextTag(currentTag) ? 'rawtext' : 'text';
            if (state === 'rawtext') rawTail = '';
          } else if (/\s/.test(c)) state = 'in-tag';
          else currentTag += c.toLowerCase();
          break;
        case 'in-tag':
          out += c;
          if (c === '>') {
            state = isRawtextTag(currentTag) ? 'rawtext' : 'text';
            if (state === 'rawtext') rawTail = '';
          } else if (!/\s/.test(c) && c !== '/') {
            state = 'attr-name';
            attrName = c;
            attrStart = out.length - 1;
          }
          break;
        case 'rawtext':
          out += c;
          rawTail = (rawTail + c.toLowerCase()).slice(-9);
          if (rawTail.endsWith('</script>') || rawTail.endsWith('</style>')) {
            state = 'text';
            rawTail = '';
            currentTag = '';
          }
          break;
        case 'attr-name':
          if (c === '=') { state = 'after-eq'; out += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; out += c; }
          else if (c === '>') { state = 'text'; attrName = ''; out += c; }
          else { attrName += c; out += c; }
          break;
        case 'after-eq':
          if (c === '"' || c === "'") { state = 'attr-quoted'; attrQuote = c; out += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; out += c; }
          else if (c === '>') { state = 'text'; attrName = ''; out += c; }
          else { state = 'attr-unquoted'; out += c; }
          break;
        case 'attr-unquoted':
          if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; out += c; }
          else if (c === '>') { state = 'text'; attrName = ''; out += c; }
          else out += c;
          break;
        case 'attr-quoted':
          out += c;
          if (c === attrQuote) { state = 'in-tag'; attrName = ''; }
          break;
      }
    }

    if (i < values.length) {
      let val = values[i];
      // Resolve promises anywhere in the value graph.
      if (val && typeof /** @type any */ (val).then === 'function') {
        val = await val;
      }
      if (state === 'comment') {
        // Holes inside <!-- comments --> are emitted raw (no escaping; comments
        // are inert and not rendered by browsers).
        out += String(val ?? '');
        commentDashes = 0;
      } else if (state === 'rawtext') {
        // Inside <script> / <style>: emit the value as-is (no HTML escaping).
        // Author is responsible for not closing the tag with user-controlled
        // data — the usual caveat for CSS/JS interpolation.
        out += String(val ?? '');
        rawTail = '';
      } else if (state === 'text') {
        out += await render(val, ctx);
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        if (prefix === '@' || prefix === '.') {
          out = out.slice(0, attrStart);
          state = 'in-tag';
          attrName = '';
        } else if (prefix === '?') {
          out = out.slice(0, attrStart);
          if (val) out += `${name}=""`;
          state = 'in-tag';
          attrName = '';
        } else {
          out += `"${escapeAttr(String(val ?? ''))}"`;
          state = 'in-tag';
          attrName = '';
        }
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
        out += escapeAttr(String(val ?? ''));
      }
    }
  }
  return out;
}

/**
 * Scan an HTML string for registered custom elements and inject
 * Declarative Shadow DOM (`<template shadowrootmode="open">`).
 * Awaits each component's render() so async components are fully resolved.
 *
 * @param {string} html
 * @param {SuspenseCtx} [ctx]
 * @returns {Promise<string>}
 */
async function injectDSD(html, ctx) {
  const tags = allTags();
  if (!tags.length) return html;
  // Attribute section is "anything that isn't `>`, with quoted values as a
  // single unit" so slashes in URL-valued attrs (e.g. then="/dashboard") don't
  // prevent the match. Non-greedy so self-closing `/>` still captures into the
  // third group.
  const pattern = new RegExp(
    `<(${tags.map(escapeRegex).join('|')})((?:"[^"]*"|'[^']*'|[^>])*?)(/?)>`,
    'g'
  );
  /** @type {{start:number, end:number, text:string}[]} */
  const edits = [];
  for (const m of html.matchAll(pattern)) {
    const [match, tag, attrs, selfClose] = m;
    const Cls = lookup(tag);
    if (!Cls) continue;
    // Track which custom elements actually appeared — used by SSR to emit
    // `<link rel="modulepreload">` hints for their module URLs.
    if (ctx && ctx.usedComponents) ctx.usedComponents.add(tag);
    const opening = selfClose ? `<${tag}${attrs}>` : match;
    if (/** @type any */ (Cls).shadow === false) {
      edits.push({ start: m.index, end: m.index + match.length, text: opening });
      continue;
    }
    try {
      const instance = new /** @type any */ (Cls)();
      const attrMap = parseAttrs(attrs);
      applyAttrsToInstance(instance, attrMap, Cls);
      let tpl = instance.render ? instance.render() : '';
      if (tpl && typeof tpl.then === 'function') tpl = await tpl;
      const inner = await render(tpl, ctx);
      /** @type {any} */
      const rawStyles = /** @type any */ (Cls).styles;
      const styleList = Array.isArray(rawStyles) ? rawStyles : rawStyles && isCSS(rawStyles) ? [rawStyles] : [];
      const styleStr = stylesToString(styleList);
      edits.push({
        start: m.index,
        end: m.index + match.length,
        text: `${opening}<template shadowrootmode="open">${styleStr}${inner}</template>`,
      });
    } catch (e) {
      console.error(`[webjs] SSR failed for <${tag}>:`, e);
    }
  }
  if (!edits.length) return html;
  // Apply edits from last to first to keep indices stable.
  let out = html;
  for (let i = edits.length - 1; i >= 0; i--) {
    const { start, end, text } = edits[i];
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

/** @param {string} s */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} tag */
function isRawtextTag(tag) {
  return tag === 'script' || tag === 'style';
}

/**
 * Minimal attribute string parser.
 * @param {string} attrStr
 * @returns {Record<string,string>}
 */
function parseAttrs(attrStr) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/**
 * Coerce attribute strings to typed properties on a component instance
 * based on its static `properties` declaration.
 */
function applyAttrsToInstance(instance, attrs, Cls) {
  const props = Cls.properties || {};
  for (const [key, raw] of Object.entries(attrs)) {
    const def = props[key] || props[camelCase(key)];
    const propName = props[key] ? key : camelCase(key);
    if (!def) {
      instance[propName] = raw;
      continue;
    }
    if (def.type === Number) instance[propName] = Number(raw);
    else if (def.type === Boolean) instance[propName] = raw !== 'false';
    else if (def.type === Object || def.type === Array) {
      try { instance[propName] = JSON.parse(raw); } catch { instance[propName] = raw; }
    } else instance[propName] = raw;
  }
}

/** @param {string} s */
function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
