import { jsonForScriptTag } from '../script-tag-json.js';
import { collectHoistedHeadTags, hoistHeadTags, wrapHead } from './head.js';

export function layoutSegmentPath(layoutFile) {
  const p = layoutFile
    .replace(/^.*\/app\//, '')
    .replace(/\/?layout\.[jt]sx?$/, '');
  return p === '' ? '/' : '/' + p;
}

export function pageSegmentPath(pageFile) {
  const p = pageFile
    .replace(/^.*\/app\//, '')
    .replace(/\/?page\.[jt]sx?$/, '');
  return p === '' ? '/' : '/' + p;
}

export function regionRouteKey(segmentPath, params) {
  const p = params || {};
  const enc = (v) => String(v).split('/').map((s) => encodeURIComponent(s)).join('/');
  const encStatic = (v) => v.replace(/[%:,]/g, (c) => encodeURIComponent(c));
  const out = [];
  for (const seg of segmentPath.split('/')) {
    if (!seg) continue;
    if (seg.startsWith('(') && seg.endsWith(')')) continue;
    if (seg.startsWith('[[...') && seg.endsWith(']]')) {
      const v = p[seg.slice(5, -2)];
      if (v) out.push(enc(v));
      continue;
    }
    if (seg.startsWith('[...') && seg.endsWith(']')) {
      const v = p[seg.slice(4, -1)];
      if (v) out.push(enc(v));
      continue;
    }
    if (seg.startsWith('[') && seg.endsWith(']')) {
      out.push(enc(p[seg.slice(1, -1)] ?? ''));
      continue;
    }
    out.push(encStatic(seg));
  }
  return '/' + out.join('/');
}

export function wrapWithChildrenMarker(tree, segmentPath, params) {
  const routeKey = regionRouteKey(segmentPath, params);
  return {
    _$webjs: 'template',
    strings: [
      `<!--wj:children:${segmentPath}:${routeKey}-->`,
      `<!--/wj:children:${segmentPath}-->`,
    ],
    values: [tree],
  };
}

export const _layoutSegmentPath = layoutSegmentPath;
export const _pageSegmentPath = pageSegmentPath;
export const _regionRouteKey = regionRouteKey;
export const _wrapWithChildrenMarker = wrapWithChildrenMarker;

export function extractUserShell(body) {
  const htmlOpen = /^\s*(?:<!doctype[^>]*>\s*)?<html\b([^>]*)>\s*([\s\S]*)<\/html>\s*$/i;
  const m = body.match(htmlOpen);
  if (!m) return null;
  const htmlAttrs = m[1] || '';
  const shellInner = m[2];

  const headRe = /<head\b([^>]*)>([\s\S]*?)<\/head>/i;
  const bodyRe = /<body\b([^>]*)>([\s\S]*?)<\/body>/i;
  const headMatch = shellInner.match(headRe);
  const bodyMatch = shellInner.match(bodyRe);

  return {
    htmlAttrs,
    headAttrs: headMatch ? (headMatch[1] || '') : '',
    userHead: headMatch ? headMatch[2] : '',
    bodyAttrs: bodyMatch ? (bodyMatch[1] || '') : '',
    userBody: bodyMatch
      ? bodyMatch[2]
      : (headMatch ? shellInner.replace(headMatch[0], '') : shellInner).trim(),
  };
}

export const _extractUserShell = extractUserShell;

function buildHeadInner(opts) {
  const full = wrapHead({ ...opts, streaming: false });
  const start = full.indexOf('<head>');
  const end = full.indexOf('</head>');
  if (start === -1 || end === -1) return '';
  return full.slice(start + '<head>'.length, end).trim();
}

export function buildDocumentParts(body, wrapOpts) {
  const shell = extractUserShell(body);
  if (shell) {
    const headInner = buildHeadInner(wrapOpts);
    const hoist = collectHoistedHeadTags(shell.userBody);
    const composedHead = [headInner, shell.userHead.trim(), hoist.tags.join('\n')]
      .filter(Boolean)
      .join('\n');
    const prefix =
      `<!doctype html>\n<html${shell.htmlAttrs}>\n<head${shell.headAttrs}>\n` +
      composedHead +
      `\n</head>\n<body${shell.bodyAttrs}>\n`;
    return { prefix, streamBody: hoist.body, closer: `\n</body>\n</html>` };
  }
  const headHtml = wrapHead(wrapOpts);
  const { head, body: bodyOut } = hoistHeadTags(headHtml, body);
  return { prefix: head, streamBody: bodyOut, closer: `\n</body>\n</html>` };
}

export const _buildDocumentParts = buildDocumentParts;

export function wrapInDocument(body, opts) {
  const { prefix, streamBody, closer } = buildDocumentParts(body, { ...opts, streaming: false });
  return prefix + streamBody + closer;
}

export function publicEnvShim(opts) {
  const source = opts?.env || process.env;
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('WEBJS_PUBLIC_') && v !== undefined) {
      env[k] = String(v);
    }
  }
  env.NODE_ENV = opts?.dev ? 'development' : 'production';
  const n = opts?.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  return `<script${n}>`
    + `window.process=window.process||{};`
    + `window.process.env=Object.assign(window.process.env||{},${jsonForScriptTag(env)});`
    + `</script>`;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
