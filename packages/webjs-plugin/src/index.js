/**
 * webjs-plugin — a TypeScript language-service plugin that resolves
 * custom-element tag names inside html`` tagged templates to the
 * corresponding webjs component class.
 *
 * Runs alongside ts-lit-plugin. When the cursor sits on a tag name
 * inside an html`` template and the upstream language service returns
 * no definition (ts-lit-plugin doesn't recognise webjs's `static tag`
 * convention), this plugin contributes one by scanning the project for
 * class declarations shaped like:
 *
 *     class Counter extends WebComponent {
 *       static tag = 'my-counter';
 *       ...
 *     }
 *
 * The scan is keyed by source-file version so it's cheap on subsequent
 * requests and is rebuilt lazily when any file changes.
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

  /** @type {Map<string, { version: string, components: Map<string, ComponentRef> }>} */
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
        return webjsDefinition(info, fileName, position) || upstream;
      } catch (e) {
        info.project.projectService.logger?.info?.(
          `webjs-plugin: getDefinitionAndBoundSpan threw: ${String(e)}`,
        );
        return upstream;
      }
    };

    return proxy;
  }

  /**
   * Main resolver. Returns a DefinitionInfoAndBoundSpan for a webjs tag
   * under the cursor, or undefined if we have no opinion.
   *
   * @param {import('typescript/lib/tsserverlibrary').server.PluginCreateInfo} info
   * @param {string} fileName
   * @param {number} position
   * @returns {import('typescript').DefinitionInfoAndBoundSpan | undefined}
   */
  function webjsDefinition(info, fileName, position) {
    const program = info.languageService.getProgram();
    if (!program) return undefined;
    const source = program.getSourceFile(fileName);
    if (!source) return undefined;

    const hit = tagUnderCursor(source, position);
    if (!hit) return undefined;

    const registry = buildRegistry(program);
    const ref = registry.get(hit.tag);
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
    // Find the innermost node at the cursor. Tagged templates cover their
    // whole body as a single TemplateExpression / NoSubstitutionTemplateLiteral.
    const templateExpr = findEnclosingHtmlTemplate(source, position);
    if (!templateExpr) return undefined;

    // Grab the full template literal text (raw, with holes replaced by the
    // original text between them — we don't need interpolated values for
    // tag detection, only structure).
    const { rawText, startPos } = getTemplateText(templateExpr);
    const offset = position - startPos;
    if (offset < 0 || offset > rawText.length) return undefined;

    return findTagAtOffset(rawText, offset, startPos);
  }

  /**
   * Walk up from the token at `position` looking for a tagged template
   * whose tag identifier is `html`. Returns that template node or
   * undefined.
   *
   * @param {import('typescript').SourceFile} source
   * @param {number} position
   * @returns {import('typescript').TaggedTemplateExpression | undefined}
   */
  function findEnclosingHtmlTemplate(source, position) {
    function walk(node) {
      if (position < node.getStart(source) || position > node.getEnd()) {
        return undefined;
      }
      // Depth-first: check children first so we return the innermost match.
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

      if (ts.isTaggedTemplateExpression(node) && tagIsHtml(node.tag)) {
        return /** @type import('typescript').TaggedTemplateExpression */ (node);
      }
      return undefined;
    }
    return walk(source);
  }

  /** @param {import('typescript').Expression} tag */
  function tagIsHtml(tag) {
    if (ts.isIdentifier(tag)) return tag.text === 'html';
    // Support `webjs.html\`...\`` or aliased imports.
    if (ts.isPropertyAccessExpression(tag)) return tag.name.text === 'html';
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
   * Rules:
   *   • Only recognise custom elements (tag names containing a hyphen).
   *   • Match on both opening and closing tags.
   *   • Ignore tags inside `${...}` interpolations (they're real JS).
   *
   * @param {string} raw   Raw template source including backticks + interpolation holes.
   * @param {number} offset Position relative to the start of the template.
   * @param {number} startPos Absolute start position of the template in the source file.
   * @returns {{ tag: string, span: import('typescript').TextSpan } | undefined}
   */
  function findTagAtOffset(raw, offset, startPos) {
    // Strip `${...}` blocks (balanced-brace). Replace with spaces of equal
    // length to preserve offsets.
    const sanitised = stripHoles(raw);
    // Match opening `<tag-name` or closing `</tag-name`.
    const re = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let m;
    while ((m = re.exec(sanitised)) !== null) {
      const tagStart = m.index + m[0].indexOf(m[1]);
      const tagEnd = tagStart + m[1].length;
      if (offset >= tagStart && offset <= tagEnd) {
        const tag = m[1].toLowerCase();
        if (!tag.includes('-')) return undefined; // not a custom element
        return {
          tag,
          span: {
            start: startPos + tagStart,
            length: m[1].length,
          },
        };
      }
    }
    return undefined;
  }

  /**
   * Replace balanced `${...}` blocks with spaces of identical length.
   * Handles nested braces (e.g. ${[{a:1}]}). Does NOT try to parse JS;
   * just tracks brace depth after a `${`.
   *
   * @param {string} raw
   * @returns {string}
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
        // Fill [start..i] with spaces so length is preserved.
        const len = i - start + 1;
        out += ' '.repeat(len);
        continue;
      }
      out += raw[i];
    }
    return out;
  }

  /* ---------------- program-wide component registry ---------------- */

  /**
   * @typedef {{
   *   fileName: string,
   *   className: string,
   *   classNameSpan: import('typescript').TextSpan,
   * }} ComponentRef
   */

  /**
   * Build or return a cached tag → ComponentRef registry for the whole
   * program. The registry is invalidated file-by-file whenever the
   * SourceFile's version changes (tsserver bumps this on every edit).
   *
   * @param {import('typescript').Program} program
   * @returns {Map<string, ComponentRef>}
   */
  function buildRegistry(program) {
    /** @type {Map<string, ComponentRef>} */
    const all = new Map();

    for (const sf of program.getSourceFiles()) {
      if (sf.fileName.includes('/node_modules/')) continue;
      const version =
        /** @type any */ (sf).version !== undefined
          ? String(/** @type any */ (sf).version)
          : `${sf.getFullStart()}:${sf.getEnd()}`;
      const cached = perFileCache.get(sf.fileName);
      let components;
      if (cached && cached.version === version) {
        components = cached.components;
      } else {
        components = extractComponents(sf);
        perFileCache.set(sf.fileName, { version, components });
      }
      for (const [tag, ref] of components) {
        // First match wins — a later file doesn't override an earlier one.
        if (!all.has(tag)) all.set(tag, ref);
      }
    }
    return all;
  }

  /**
   * Extract webjs components from a single source file by scanning for
   * `customElements.define('<tag>', <ClassName>)` calls and matching
   * the class identifier back to a class declaration in the same file.
   *
   * @param {import('typescript').SourceFile} sf
   * @returns {Map<string, ComponentRef>}
   */
  function extractComponents(sf) {
    /** @type {Map<string, ComponentRef>} */
    const out = new Map();

    // First pass: index every local class declaration by its identifier
    // text so the define-call pass can resolve class references without
    // a type-checker lookup.
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

    // Second pass: find customElements.define(tag, Class) calls.
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const match = readDefineCall(node);
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

    // Object side must be `customElements` (or `window.customElements`).
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
