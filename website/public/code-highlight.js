/*
 * Progressive-enhancement syntax highlighter for docs code samples.
 *
 * Code is server-rendered as plain monochrome text inside <pre> (readable
 * with JavaScript off). On the client this script tokenizes each block and
 * wraps tokens in <span class="t-*"> so they pick up the theme-aware cool
 * palette declared once in the layout stylesheet. It mirrors the website's
 * lib/highlight.ts tokenizer so the colors match across every webjs surface.
 *
 * A MutationObserver re-runs on client-router navigations (new <pre> nodes
 * swapped into the DOM), and a data-hl guard prevents double processing.
 */
(function () {
  var KEYWORDS = {
    import: 1, from: 1, export: 1, default: 1, async: 1, function: 1,
    return: 1, const: 1, let: 1, var: 1, await: 1, new: 1, class: 1,
    extends: 1, if: 1, else: 1, for: 1, of: 1, in: 1, true: 1, false: 1,
    null: 1, undefined: 1, this: 1, typeof: 1, throw: 1, try: 1, catch: 1,
    void: 1, static: 1, as: 1,
  };
  var CLASS = { com: 't-com', str: 't-str', num: 't-num', kw: 't-kw', fn: 't-fn', type: 't-type' };
  var ident = /[A-Za-z0-9_$]/;
  var identStart = /[A-Za-z_$@]/;
  var numChar = /[0-9._a-fxA-FX]/;

  function tokenize(src) {
    var out = [];
    var i = 0;
    var n = src.length;
    function push(t, v) { if (v) out.push({ t: t, v: v }); }
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t' || c === '\n') {
        var j = i + 1;
        while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
        push('ws', src.slice(i, j)); i = j; continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        var j2 = i + 2;
        while (j2 < n && src[j2] !== '\n') j2++;
        push('com', src.slice(i, j2)); i = j2; continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        var j3 = i + 2;
        while (j3 < n && !(src[j3] === '*' && src[j3 + 1] === '/')) j3++;
        j3 = Math.min(n, j3 + 2);
        push('com', src.slice(i, j3)); i = j3; continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        var j4 = i + 1;
        var closed4 = false;
        while (j4 < n) {
          if (src[j4] === '\\') { j4 += 2; continue; }
          if (src[j4] === '\n' && c !== '`') break; // ' and " do not span lines
          if (src[j4] === c) { closed4 = true; j4++; break; }
          j4++;
        }
        // A backtick template spans lines; a ' or " that never closes on its
        // own line is not a string (e.g. an apostrophe in prose), so emit the
        // quote as punctuation and keep tokenizing the rest of the line.
        if (c === '`' || closed4) { push('str', src.slice(i, j4)); i = j4; continue; }
        push('punc', c); i++; continue;
      }
      if (c >= '0' && c <= '9') {
        var j5 = i + 1;
        while (j5 < n && numChar.test(src[j5])) j5++;
        push('num', src.slice(i, j5)); i = j5; continue;
      }
      if (c === '#' && src[i + 1] === ' ') {
        // Shell-style line comment: '#' starts the line AND is followed by a
        // space, so a CSS id selector (#app), a JS private field (#count), or a
        // hex color (#fff) is not swallowed, only a real "# comment".
        var bk = i - 1;
        while (bk >= 0 && (src[bk] === ' ' || src[bk] === '\t')) bk--;
        if (bk < 0 || src[bk] === '\n') {
          var jh = i + 1;
          while (jh < n && src[jh] !== '\n') jh++;
          push('com', src.slice(i, jh)); i = jh; continue;
        }
      }
      if (identStart.test(c)) {
        var j6 = i + 1;
        while (j6 < n && ident.test(src[j6])) j6++;
        var word = src.slice(i, j6);
        var k = j6;
        while (k < n && src[k] === ' ') k++;
        if (KEYWORDS[word]) push('kw', word);
        else if (src[k] === '(') push('fn', word);
        else if (/^[A-Z]/.test(word)) push('type', word);
        else push('id', word);
        i = j6; continue;
      }
      push('punc', c); i++;
    }
    return out;
  }

  function highlight(pre) {
    if (pre.dataset.hl) return;
    var code = pre.querySelector('code') || pre;
    // Only highlight plain-text blocks. If the code already contains element
    // markup (server-rendered spans, links, emphasis), leave it untouched
    // rather than flatten it.
    if (code.children.length) return;
    pre.dataset.hl = '1';
    var toks = tokenize(code.textContent.replace(/^\n+|\n+$/g, ''));
    var frag = document.createDocumentFragment();
    for (var i = 0; i < toks.length; i++) {
      var cls = CLASS[toks[i].t];
      if (cls) {
        var s = document.createElement('span');
        s.className = cls;
        s.textContent = toks[i].v;
        frag.appendChild(s);
      } else {
        frag.appendChild(document.createTextNode(toks[i].v));
      }
    }
    code.textContent = '';
    code.appendChild(frag);
  }

  function run(root) {
    var list = (root || document).querySelectorAll('pre');
    for (var i = 0; i < list.length; i++) highlight(list[i]);
  }

  function init() {
    run(document);
    new MutationObserver(function (muts) {
      for (var a = 0; a < muts.length; a++) {
        var added = muts[a].addedNodes;
        for (var b = 0; b < added.length; b++) {
          var node = added[b];
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('pre')) highlight(node);
          if (node.querySelectorAll) run(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
