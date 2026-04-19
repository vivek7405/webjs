/**
 * webjs-plugin — a TypeScript language-service plugin that resolves
 *
 *   1. Custom-element tag names inside `html\`\`` tagged templates → the
 *      corresponding WebComponent class declaration.
 *   2. CSS class names inside `class="…"` attributes of `html\`\`` templates
 *      → the rule that defines them in a `css\`\`` tagged template.
 *
 * Runs alongside ts-lit-plugin. Whenever upstream returns no definition,
 * this plugin tries both resolvers in turn.
 *
 * Registration scan is keyed by each SourceFile's version so subsequent
 * lookups are cheap and invalidate incrementally on edits.
 */

'use strict';

/* eslint-disable no-restricted-syntax */

/**
 * TypeScript Language Service plugin factory.
 *
 * @param {{ typescript: typeof import('typescript') }} modules
 */
function init(modules) {
  const ts = modules.typescript;

  /** @type {Map<string, { version: string, components: Map<string, ComponentRef>, classes: Map<string, CssClassRef[]> }>} */
  const perFileCache = new Map();

  return { create };

  /** @param {import('typescript/lib/tsserverlibrary').server.PluginCreateInfo} info */
  function create(info) {
    const proxy = Object.create(null);
    const inner = info.languageService;
    for (const k of Object.keys(inner)) {
      proxy[k] = /** @type any */ (inner[/** @type any */ (k)]).bind(inner);
    }

    proxy.getDefinitionAndBoundSpan = (fileName, position) => {
      // Always try upstream first — ts-lit-plugin / stock tsserver may
      // already have an answer for Lit-style components, JSDoc-tagged
      // elements, or HTMLElementTagNameMap-augmented tags.
      const upstream = inner.getDefinitionAndBoundSpan(fileName, position);
      if (upstream && upstream.definitions && upstream.definitions.length > 0) {
        return upstream;
      }
      try {
        return (
          webjsTagDefinition(info, fileName, position) ||
          webjsCssClassDefinition(info, fileName, position) ||
          upstream
        );
      } catch (e) {
        info.project.projectService.logger?.info?.(
          `webjs-plugin: getDefinitionAndBoundSpan threw: ${String(e)}`,
        );
        return upstream;
      }
    };

    return proxy;
  }

  /* ================================================================
   * Resolver 1: custom-element tag → component class
   * ================================================================ */

  /**
   * @param {import('typescript/lib/tsserverlibrary').server.PluginCreateInfo} info
   * @param {string} fileName
   * @param {number} position
   * @returns {import('typescript').DefinitionInfoAndBoundSpan | undefined}
   */
  function webjsTagDefinition(info, fileName, position) {
    const program = info.languageService.getProgram();
    if (!program) return undefined;
    const source = program.getSourceFile(fileName);
    if (!source) return undefined;

    const hit = tagUnderCursor(source, position);
    if (!hit) return undefined;

    const registry = buildRegistry(program);
    const ref = registry.components.get(hit.tag);
    if (!ref) return undefined;

    return {
      textSpan: hit.span,
      definitions: [
        {
          fileName: ref.fileName,
          textSpan: ref.classNameSpan,
          kind: /** @type any */ (ts.ScriptElementKind).classElement,
          name: ref.className,
          containerKind: /** @type any */ (ts.ScriptElementKind).moduleElement,
          containerName: '',
        },
      ],
    };
  }

  /* ================================================================
   * Resolver 2: CSS class name in html`class="…"` → css`` rule
   * ================================================================ */

  /**
   * @param {import('typescript/lib/tsserverlibrary').server.PluginCreateInfo} info
   * @param {string} fileName
   * @param {number} position
   * @returns {import('typescript').DefinitionInfoAndBoundSpan | undefined}
   */
  function webjsCssClassDefinition(info, fileName, position) {
    const program = info.languageService.getProgram();
    if (!program) return undefined;
    const source = program.getSourceFile(fileName);
    if (!source) return undefined;

    const hit = classUnderCursor(source, position);
    if (!hit) return undefined;

    const registry = buildRegistry(program);
    const refs = registry.classes.get(hit.className);
    if (!refs || refs.length === 0) return undefined;

    return {
      textSpan: hit.span,
      definitions: refs.map((r) => ({
        fileName: r.fileName,
        textSpan: r.span,
        kind: /** @type any */ (ts.ScriptElementKind).classElement,
        name: `.${hit.className}`,
        containerKind: /** @type any */ (ts.ScriptElementKind).moduleElement,
        containerName: '',
      })),
    };
  }

  /* ---------------- cursor → tag detection ---------------- */

  /**
   * If `position` lies on a custom-element tag name inside an `html\`\``
   * tagged template literal, return the tag and the span covering it.
   *
   * @param {import('typescript').SourceFile} source
   * @param {number} position
   * @returns {{ tag: string, span: import('typescript').TextSpan } | undefined}
   */
  function tagUnderCursor(source, position) {
    const templateExpr = findEnclosingTaggedTemplate(source, position, 'html');
    if (!templateExpr) return undefined;

    const { rawText, startPos } = getTemplateText(templateExpr);
    const offset = position - startPos;
    if (offset < 0 || offset > rawText.length) return undefined;

    return findTagAtOffset(rawText, offset, startPos);
  }

  /**
   * If `position` lies on a class name inside a `class="…"` attribute of
   * an `html\`\`` template, return the class and its span.
   *
   * @param {import('typescript').SourceFile} source
   * @param {number} position
   * @returns {{ className: string, span: import('typescript').TextSpan } | undefined}
   */
  function classUnderCursor(source, position) {
    const templateExpr = findEnclosingTaggedTemplate(source, position, 'html');
    if (!templateExpr) return undefined;

    const { rawText, startPos } = getTemplateText(templateExpr);
    const offset = position - startPos;
    if (offset < 0 || offset > rawText.length) return undefined;

    return findClassAtOffset(rawText, offset, startPos);
  }

  /**
   * Walk up from the token at `position` looking for a tagged template
   * whose tag identifier matches `name` (e.g. `html`, `css`). Returns
   * that template node or undefined.
   *
   * @param {import('typescript').SourceFile} source
   * @param {number} position
   * @param {string} name
   * @returns {import('typescript').TaggedTemplateExpression | undefined}
   */
  function findEnclosingTaggedTemplate(source, position, name) {
    function walk(node) {
      if (position < node.getStart(source) || position > node.getEnd()) {
        return undefined;
      }
      let found;
      ts.forEachChild(node, (c) => {
        const hit = walk(c);
        if (hit) {
          found = hit;
          return true;
        }
        return undefined;
      });
      if (found) return found;

      if (ts.isTaggedTemplateExpression(node) && tagMatches(node.tag, name)) {
        return /** @type import('typescript').TaggedTemplateExpression */ (node);
      }
      return undefined;
    }
    return walk(source);
  }

  /**
   * @param {import('typescript').Expression} tag
   * @param {string} name
   */
  function tagMatches(tag, name) {
    if (ts.isIdentifier(tag)) return tag.text === name;
    if (ts.isPropertyAccessExpression(tag)) return tag.name.text === name;
    return false;
  }

  /**
   * Extract the raw template source (braces of `${...}` are preserved).
   *
   * @param {import('typescript').TaggedTemplateExpression} expr
   * @returns {{ rawText: string, startPos: number }}
   */
  function getTemplateText(expr) {
    const t = expr.template;
    const src = expr.getSourceFile().text;
    const startPos = t.getStart(expr.getSourceFile());
    const endPos = t.getEnd();
    return { rawText: src.slice(startPos, endPos), startPos };
  }

  /**
   * Scan the raw template text and find the tag name whose span contains
   * `offset`. Returns the tag (lowercased) and its absolute span in the
   * source file.
   *
   * @param {string} raw
   * @param {number} offset
   * @param {number} startPos
   * @returns {{ tag: string, span: import('typescript').TextSpan } | undefined}
   */
  function findTagAtOffset(raw, offset, startPos) {
    const sanitised = stripHoles(raw);
    const re = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let m;
    while ((m = re.exec(sanitised)) !== null) {
      const tagStart = m.index + m[0].indexOf(m[1]);
      const tagEnd = tagStart + m[1].length;
      if (offset >= tagStart && offset <= tagEnd) {
        const tag = m[1].toLowerCase();
        if (!tag.includes('-')) return undefined;
        return {
          tag,
          span: { start: startPos + tagStart, length: m[1].length },
        };
      }
    }
    return undefined;
  }

  /**
   * Scan the raw template text for `class="…"` / `class='…'` attributes
   * and return the class name whose span contains `offset`.
   *
   * Only string-literal attribute values are considered; `class=${…}`
   * dynamic expressions are skipped (we can't statically know the
   * concatenated class set).
   *
   * @param {string} raw
   * @param {number} offset
   * @param {number} startPos
   * @returns {{ className: string, span: import('typescript').TextSpan } | undefined}
   */
  function findClassAtOffset(raw, offset, startPos) {
    const sanitised = stripHoles(raw);
    // Match `class="..."` or `class='...'`. The value is captured so we can
    // walk its individual class names.
    const re = /\bclass\s*=\s*(["'])([^"']*)\1/g;
    let m;
    while ((m = re.exec(sanitised)) !== null) {
      const valueStart = m.index + m[0].indexOf(m[2]); // skip `class="`
      const value = m[2];
      if (offset < valueStart || offset > valueStart + value.length) continue;
      // Split the value into whitespace-separated class tokens and find
      // which one the cursor is on.
      let i = 0;
      while (i < value.length) {
        while (i < value.length && /\s/.test(value[i])) i++;
        const tokenStart = i;
        while (i < value.length && !/\s/.test(value[i])) i++;
        const tokenEnd = i;
        if (tokenEnd > tokenStart) {
          const absStart = valueStart + tokenStart;
          const absEnd = valueStart + tokenEnd;
          if (offset >= absStart && offset <= absEnd) {
            const className = value.slice(tokenStart, tokenEnd);
            if (!isValidClassIdent(className)) return undefined;
            return {
              className,
              span: {
                start: startPos + absStart,
                length: className.length,
              },
            };
          }
        }
      }
    }
    return undefined;
  }

  /** @param {string} s */
  function isValidClassIdent(s) {
    return /^[A-Za-z_][\w-]*$/.test(s);
  }

  /**
   * Replace balanced `${...}` blocks with spaces of identical length.
   * Handles nested braces (e.g. ${[{a:1}]}). Does NOT try to parse JS;
   * just tracks brace depth after a `${`.
   *
   * @param {string} raw
   */
  function stripHoles(raw) {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '$' && raw[i + 1] === '{') {
        const start = i;
        i += 2;
        let depth = 1;
        while (i < raw.length && depth > 0) {
          if (raw[i] === '{') depth++;
          else if (raw[i] === '}') depth--;
          if (depth === 0) break;
          i++;
        }
        const len = i - start + 1;
        out += ' '.repeat(len);
        continue;
      }
      out += raw[i];
    }
    return out;
  }

  /* ---------------- program-wide registry ---------------- */

  /**
   * @typedef {{
   *   fileName: string,
   *   className: string,
   *   classNameSpan: import('typescript').TextSpan,
   * }} ComponentRef
   *
   * @typedef {{
   *   fileName: string,
   *   span: import('typescript').TextSpan,
   * }} CssClassRef
   */

  /**
   * Build or return cached tag → ComponentRef and class-name → CssClassRef
   * registries for the whole program. Invalidated file-by-file on version
   * change (tsserver bumps this on every edit).
   *
   * @param {import('typescript').Program} program
   * @returns {{ components: Map<string, ComponentRef>, classes: Map<string, CssClassRef[]> }}
   */
  function buildRegistry(program) {
    /** @type {Map<string, ComponentRef>} */
    const components = new Map();
    /** @type {Map<string, CssClassRef[]>} */
    const classes = new Map();

    for (const sf of program.getSourceFiles()) {
      if (sf.fileName.includes('/node_modules/')) continue;
      const version =
        /** @type any */ (sf).version !== undefined
          ? String(/** @type any */ (sf).version)
          : `${sf.getFullStart()}:${sf.getEnd()}`;
      const cached = perFileCache.get(sf.fileName);
      let fileComponents;
      let fileClasses;
      if (cached && cached.version === version) {
        fileComponents = cached.components;
        fileClasses = cached.classes;
      } else {
        fileComponents = extractComponents(sf);
        fileClasses = extractCssClasses(sf);
        perFileCache.set(sf.fileName, {
          version,
          components: fileComponents,
          classes: fileClasses,
        });
      }
      for (const [tag, ref] of fileComponents) {
        if (!components.has(tag)) components.set(tag, ref);
      }
      for (const [name, refs] of fileClasses) {
        const all = classes.get(name) || [];
        for (const r of refs) all.push(r);
        classes.set(name, all);
      }
    }
    return { components, classes };
  }

  /**
   * Extract webjs components from a single source file by scanning for
   * `Class.register('tag')` or `customElements.define('tag', Class)`.
   *
   * @param {import('typescript').SourceFile} sf
   * @returns {Map<string, ComponentRef>}
   */
  function extractComponents(sf) {
    /** @type {Map<string, ComponentRef>} */
    const out = new Map();

    /** @type {Map<string, { span: import('typescript').TextSpan }>} */
    const localClasses = new Map();
    function indexClasses(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        localClasses.set(node.name.text, {
          span: {
            start: node.name.getStart(sf),
            length: node.name.getWidth(sf),
          },
        });
      }
      ts.forEachChild(node, indexClasses);
    }
    indexClasses(sf);

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const match = readDefineCall(node) || readRegisterCall(node);
        if (match && match.tag.includes('-')) {
          const local = localClasses.get(match.className);
          if (local) {
            out.set(match.tag, {
              fileName: sf.fileName,
              className: match.className,
              classNameSpan: local.span,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    return out;
  }

  /**
   * Extract CSS class definitions from every `css\`…\`` tagged template in
   * the file. Each occurrence of `.class-name` in the template text is
   * recorded as a potential definition — if the user go-to-definitions on
   * a class name and the plugin finds one or more matches across the
   * program, they are offered as the destination(s).
   *
   * This is a lexical scan; it doesn't parse CSS. Good enough for the
   * common case (scope wrappers, nested rules, hover/focus pseudo-classes).
   *
   * @param {import('typescript').SourceFile} sf
   * @returns {Map<string, CssClassRef[]>}
   */
  function extractCssClasses(sf) {
    /** @type {Map<string, CssClassRef[]>} */
    const out = new Map();

    function visit(node) {
      if (ts.isTaggedTemplateExpression(node) && tagMatches(node.tag, 'css')) {
        const src = sf.text;
        const t = node.template;
        const start = t.getStart(sf);
        const end = t.getEnd();
        // Scan the raw literal text (including interpolation markers —
        // they're unlikely to collide with a class-name pattern).
        const body = src.slice(start, end);
        const re = /\.([A-Za-z_][\w-]*)/g;
        let m;
        while ((m = re.exec(body)) !== null) {
          // Skip matches that are part of a decimal number (e.g. `1.5rem`):
          // the character preceding the `.` is a digit.
          const prevIdx = m.index - 1;
          if (prevIdx >= 0 && /[0-9]/.test(body[prevIdx])) continue;
          const name = m[1];
          const absStart = start + m.index + 1; // skip the leading `.`
          const ref = {
            fileName: sf.fileName,
            span: { start: absStart, length: name.length },
          };
          const existing = out.get(name);
          if (existing) existing.push(ref);
          else out.set(name, [ref]);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    return out;
  }

  /**
   * Match `Counter.register('my-counter')` where the LHS identifier is
   * a locally-declared class and the sole argument is a string literal.
   *
   * @param {import('typescript').CallExpression} call
   * @returns {{ tag: string, className: string } | undefined}
   */
  function readRegisterCall(call) {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    if (callee.name.text !== 'register') return undefined;
    if (!ts.isIdentifier(callee.expression)) return undefined;
    const [arg] = call.arguments;
    if (!arg || !ts.isStringLiteralLike(arg)) return undefined;
    return { tag: arg.text, className: callee.expression.text };
  }

  /**
   * Match `customElements.define('tag', ClassIdent)` and return the
   * extracted pair. Handles both `customElements.define(...)` and
   * `window.customElements.define(...)` forms.
   *
   * @param {import('typescript').CallExpression} call
   * @returns {{ tag: string, className: string } | undefined}
   */
  function readDefineCall(call) {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    if (callee.name.text !== 'define') return undefined;

    const obj = callee.expression;
    if (ts.isIdentifier(obj)) {
      if (obj.text !== 'customElements') return undefined;
    } else if (ts.isPropertyAccessExpression(obj)) {
      if (obj.name.text !== 'customElements') return undefined;
    } else {
      return undefined;
    }

    const [tagArg, classArg] = call.arguments;
    if (!tagArg || !classArg) return undefined;
    if (!ts.isStringLiteralLike(tagArg)) return undefined;
    if (!ts.isIdentifier(classArg)) return undefined;

    return { tag: tagArg.text, className: classArg.text };
  }
}

module.exports = init;
