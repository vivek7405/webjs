import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, '../../.claude/hooks/block-prose-punctuation.sh');

/** Run the hook with the given content as a Write payload. Returns the result. */
function runContent(content) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_input: { content } }),
    encoding: 'utf8',
  });
}

// The brand token and the em-dash are assembled at runtime so this source
// file never itself carries a literal form the live hook would block.
const B = 'web' + 'js';

test('blocks em-dash anywhere', () => {
  const emDash = String.fromCharCode(0x2014);
  assert.equal(runContent(`foo ${emDash} bar`).status, 2);
});

// --- Rule 2 / 3 prose contexts: JSON prose values and YAML front matter ---

test('blocks a pause-hyphen in a JSON description / title / displayName value', () => {
  const r = runContent('  "description": "A library - for things",');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /pause-hyphen/);
  assert.equal(runContent('  "title": "Neutral - the default palette",').status, 2);
  assert.equal(runContent('  "displayName": "Editor - all in one",').status, 2);
  // Deeply nested, the way the config JSON Schema indents its field docs.
  assert.equal(runContent('            "description": "A library - for things",').status, 2);
  // The string that sat in the repo root manifest before this rule existed.
  assert.equal(
    runContent('  "description": "WebJs - AI-first, web-components-first framework.",').status,
    2,
  );
});

test('blocks a pause-semicolon in a JSON description value', () => {
  const r = runContent('  "description": "Forms work ; links work too.",');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /pause-semicolon/);
});

test('blocks a pause-hyphen in column-0 YAML front matter', () => {
  assert.equal(runContent('description: A framework - for the web.').status, 2);
  assert.equal(runContent('title: Signals - the default state primitive').status, 2);
});

test('the four original prose contexts still block (unchanged)', () => {
  assert.equal(runContent('# A library - for things').status, 2);
  assert.equal(runContent('> A library - for things').status, 2);
  assert.equal(runContent('// A library - for things').status, 2);
  // Assembled so this source file does not itself carry the HTML prose shape.
  assert.equal(runContent('<li>A library ' + '- for things</li>').status, 2);
});

// --- Rule 2 / 3 allow: every code-shaped JSON value lives under another key ---

test('allows code-shaped JSON values, which sit under keys the rule ignores', () => {
  const allowed = [
    '    "drizzle-orm": "1.2.3 - 2.3.4",',
    '    "node": ">=24.0.0-alpha - 25",',
    '    "test:e2e": "node scripts/run.js --filter - --bail",',
    '    "command": ".claude/hooks/require-docs - src.sh"',
    '  "name": "@webjsdev/ui-registry",',
    '    "basePath": "/app - v2",',
    '  "main": "./src/index.js",',
    '      "default": "(cast((julianday(a) - 2440587.5)*86400 as integer))",',
  ];
  for (const line of allowed) {
    assert.equal(runContent(line).status, 0, `should allow: ${line}`);
  }
});

test('allows compound words and an ordinary semicolon inside a scanned value', () => {
  // Proves the shared character-class core was reused rather than reinvented:
  // a compound word has no surrounding spaces, so it cannot match.
  assert.equal(
    runContent('  "description": "An AI-first, web-components-first framework.",').status,
    0,
  );
  // Only the space-surrounded semicolon is banned.
  assert.equal(
    runContent('  "description": "Returns the envelope; the import becomes a stub.",').status,
    0,
  );
});

test('allows an INDENTED YAML description (a workflow input, not front matter)', () => {
  // The column-0 anchor is what confines the front-matter rule to front matter.
  assert.equal(runContent('        description: Republish every changelog - one time').status, 0);
});

// --- The SIGPIPE fix: rules 1 through 4 must survive a large payload ---

test('blocks reliably on a 200 KB payload (no SIGPIPE skip)', () => {
  const filler = '\n' + 'x'.repeat(200_000);
  const emDash = String.fromCharCode(0x2014);
  const cases = [
    ['markdown heading', '# A library - for things' + filler],
    ['JSON description', '  "description": "A library - for things",' + filler],
    ['em-dash', `foo ${emDash} bar` + filler],
  ];
  // Loop: the pre-fix bug was a race on the pipe buffer, so a single run could
  // pass against the broken hook.
  for (const [label, content] of cases) {
    for (let i = 0; i < 5; i++) {
      assert.equal(runContent(content).status, 2, `${label}, run ${i + 1}`);
    }
  }
});

// --- The brand rule blocks (lowercase "webjs" naming the brand in prose) ---

test('blocks lowercase brand at a line start', () => {
  const r = runContent(`${B} ships a cache() helper.`);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /naming the brand in prose/);
});

test('blocks lowercase brand after a full stop', () => {
  assert.equal(runContent(`The wire round-trips. ${B} rewrites the import.`).status, 2);
});

test('blocks lowercase brand after a question mark and exclamation', () => {
  assert.equal(runContent(`Prefer Bun? ${B} runs on Bun too.`).status, 2);
  assert.equal(runContent(`Fast! ${B} skips the build step.`).status, 2);
});

test('blocks emphasis-wrapped brand', () => {
  assert.equal(runContent(`**${B}** is AI-first.`).status, 2);
  assert.equal(runContent(`_${B}_ is neat.`).status, 2);
});

test('blocks brand right after a prose HTML tag', () => {
  assert.equal(runContent(`<p>${B} is a framework.</p>`).status, 2);
});

test('blocks brand at a markdown list / heading / blockquote start', () => {
  assert.equal(runContent(`- ${B} ships the cache helper.`).status, 2);
  assert.equal(runContent(`## ${B} overview`).status, 2);
  assert.equal(runContent(`> ${B} runs on Node and Bun.`).status, 2);
});

test('blocks the brand mid-sentence as the subject of ANY verb (no allowlist)', () => {
  // The inverted rule flags by default, so it is not limited to a known verb
  // set: powers / handles / orchestrates all block, not just ships / renders.
  assert.equal(runContent(`On Bun, ${B} powers the listener.`).status, 2);
  assert.equal(runContent(`${B} handles routing automatically.`).status, 2);
  assert.equal(runContent(`In practice, ${B} orchestrates the render.`).status, 2);
});

test('blocks the brand used attributively (webjs apps -> WebJs apps)', () => {
  assert.equal(runContent(`Most ${B} apps ship without a build step.`).status, 2);
  assert.equal(runContent(`Build a ${B} app in minutes.`).status, 2);
});

test('blocks a non-CLI noun follower (brand, not a token)', () => {
  assert.equal(runContent(`The ${B} serializer round-trips a Map.`).status, 2);
  assert.equal(runContent(`A ${B} server is one Node process.`).status, 2);
  assert.equal(runContent(`In a ${B} project you edit and refresh.`).status, 2);
});

test('blocks a verb that merely starts with a CLI subcommand string', () => {
  // "webjs seeds" is the brand + a verb, NOT the `seed` CLI, so it blocks
  // (the word boundary after the subcommand prevents a false CLI match).
  assert.equal(runContent(`${B} seeds each SSR action result.`).status, 2);
});

test('blocks an un-backticked config-key mention (write WebJs or backtick it)', () => {
  // Blunt like the em-dash rule: an un-backticked "webjs config" is treated as
  // the brand. To keep the literal key lowercase, wrap it in backticks.
  assert.equal(runContent(`Set the ${B} config block in package.json.`).status, 2);
});

// --- The brand rule allows (capitalized, CLI, tokens, code) ---

test('allows the correctly-capitalized brand', () => {
  assert.equal(runContent('WebJs ships a cache() helper.').status, 0);
  assert.equal(runContent('On Bun, WebJs powers the listener.').status, 0);
  assert.equal(runContent('Most WebJs apps ship without a build step.').status, 0);
});

test('allows every CLI subcommand family (kept lowercase)', () => {
  assert.equal(runContent(`Run \`${B} dev\` to start.`).status, 0);
  assert.equal(runContent(`- ${B} check runs the validator.`).status, 0);
  assert.equal(runContent(`${B} create my-app --template api`).status, 0);
  assert.equal(runContent(`First ${B} db migrate, then boot.`).status, 0);
  assert.equal(runContent(`Use ${B} vendor pin to lock imports.`).status, 0);
  assert.equal(runContent(`${B} ui add button copies it in.`).status, 0);
  assert.equal(runContent(`${B} help prints the usage banner.`).status, 0);
});

test('allows a package.json script value ending in `webjs <subcmd>` before a quote', () => {
  // A JSON script line puts a closing quote right after the subcommand, with no
  // trailing flag. That is a command, not brand prose, so it must pass (#956).
  const pkg = `{\n  "scripts": { "start": "${B} start", "test": "${B} test" }\n}`;
  assert.equal(runContent(pkg).status, 0);
  // Single-quoted shell form is a command too.
  assert.equal(runContent(`command = '${B} dev'`).status, 0);
});

test('allows `webjs <subcmd>` inside an HTML tag boundary (docs headings / code)', () => {
  // The docs pages reference commands as `<h3>webjs routes</h3>` and
  // `<code>webjs types</code>`, where the subcommand is immediately followed by
  // a `<` (or `>`). That is a command, not brand prose, so it must pass (#975).
  assert.equal(runContent(`<h3>${B} routes</h3>`).status, 0);
  assert.equal(runContent(`<code>${B} types</code>`).status, 0);
  assert.equal(runContent(`<h3>${B} doctor</h3>`).status, 0);
  // Counterfactual: a real verb after the brand before a tag still blocks (the
  // widening admits only known subcommands, not arbitrary words).
  assert.equal(runContent(`<p>${B} powers</p>`).status, 2);
});

test('still blocks genuine lowercase-brand prose (counterfactual for #956)', () => {
  // The quote widening must NOT let real brand prose through: the brand followed
  // by a verb is not a `ship` subcommand, so it still blocks.
  assert.equal(runContent(`${B} ships a listener.`).status, 2);
});

test('allows the brand as a domain / package / config-key / env / repo token', () => {
  assert.equal(runContent(`Set it in ${B}.dev config.`).status, 0);
  assert.equal(runContent(`Import from @${B}dev/core.`).status, 0);
  assert.equal(runContent('Reads WEBJS_PUBLIC_API_URL at boot.').status, 0);
  assert.equal(runContent(`Open an issue on the ${B}dev/${B} board.`).status, 0);
  assert.equal(runContent(`The <${B}-suspense> element streams.`).status, 0);
});

test('allows the brand inside an inline code span or fenced block', () => {
  assert.equal(runContent(`The \`${B}\` command exists.`).status, 0);
  assert.equal(runContent(`The \`${B} config\` key is read at boot.`).status, 0);
  assert.equal(runContent('```\n' + `${B} is a framework.\n` + '```').status, 0);
});

test('does NOT false-block ordinary code (webjs as an identifier / operand)', () => {
  // The follower rule (word or sentence-period only) leaves these code shapes
  // alone, so editing real source is never wrongly blocked.
  assert.equal(runContent(`if (!${B}) return emptyTasks();`).status, 0);
  assert.equal(runContent(`const ${B} = pkg.${B};`).status, 0);
  assert.equal(runContent(`const cfg = { ${B}: { elide: true } };`).status, 0);
  assert.equal(runContent(`plugins.push(${B}, other);`).status, 0);
});

test('known false-negatives: EOL / parenthesized brand are allowed (FN bias)', () => {
  // Documented misses. The one-time fix handles existing such prose; the hook
  // biases toward not blocking rather than risk a code false-positive.
  assert.equal(runContent(`Built with ${B}`).status, 0);
  assert.equal(runContent(`(built on ${B})`).status, 0);
});

// --- Drift guard: the tracked tree itself must pass the prose-key rules ---

const REPO_ROOT = resolve(HERE, '../..');

/** The four prose-key patterns, read out of the live hook so nothing is duplicated. */
function proseKeyPatterns() {
  const hookSrc = readFileSync(HOOK, 'utf8');
  const pats = [...hookSrc.matchAll(/^if grep -qE '(.*)' <<< "\$new_content"; then$/gm)]
    .map((m) => m[1])
    .filter((p) => p.includes('(description|title|displayName)'));
  assert.equal(pats.length, 4, 'hook carries the four prose-key patterns');
  return pats;
}

test('no tracked JSON or front-matter prose value carries a banned pause', () => {
  for (const pattern of proseKeyPatterns()) {
    const r = spawnSync('git', ['grep', '-nE', pattern, '--', '*.json', '*.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    // git grep exits 1 when nothing matches, which is the passing case.
    assert.equal(r.status, 1, `pause found in a prose value:\n${r.stdout}`);
  }
});

// --- Drift guard: all three copies of the hook stay in step ---

test('the scaffold and dogfood hook copies carry the same rules', () => {
  const scaffold = resolve(REPO_ROOT, 'packages/cli/templates/.claude/hooks/block-prose-punctuation.sh');
  const blog = resolve(REPO_ROOT, 'examples/blog/.claude/hooks/block-prose-punctuation.sh');
  const scaffoldSrc = readFileSync(scaffold, 'utf8');
  assert.equal(scaffoldSrc, readFileSync(blog, 'utf8'), 'the two copies are byte-identical');

  for (const pattern of proseKeyPatterns()) {
    assert.ok(scaffoldSrc.includes(pattern), `copy is missing a prose-key pattern: ${pattern}`);
  }
  // The SIGPIPE fix must hold in every copy: a `grep -q` behind a pipe silently
  // skips its rule once the payload outgrows the pipe buffer.
  for (const [label, src] of [['repo', readFileSync(HOOK, 'utf8')], ['scaffold', scaffoldSrc]]) {
    assert.equal(
      /^if printf .*\| grep -q/m.test(src),
      false,
      `${label} copy still pipes into grep -q`,
    );
  }
});

// --- Drift guard: the hook CLI list must cover the real CLI subcommands ---

test('hook CLI list covers the CLI top-level subcommands (drift guard)', () => {
  const hookSrc = readFileSync(HOOK, 'utf8');
  const m = hookSrc.match(/webjs_cli='([^']+)'/);
  assert.ok(m, 'webjs_cli variable is present in the hook');
  const hookCli = new Set(m[1].split('|'));

  const binSrc = readFileSync(resolve(HERE, '../../packages/cli/bin/webjs.js'), 'utf8');
  const commands = [...binSrc.matchAll(/case '([a-z][a-z-]*)'/g)].map((x) => x[1]);
  assert.ok(commands.length > 5, 'found the command switch case labels');
  for (const cmd of commands) {
    assert.ok(hookCli.has(cmd), `hook webjs_cli is missing CLI subcommand "${cmd}"`);
  }
});
