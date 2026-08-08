import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, basename, relative as relPath } from 'node:path';
import prompts from 'prompts';
import { execSync } from 'node:child_process';
import { getConfig } from '../utils/get-config.js';
import { logger } from '../utils/logger.js';
import { resolveTree, collectNpmDeps } from '../registry/resolver.js';
import { DEFAULT_REGISTRY_URL } from '../registry/fetcher.js';
import { isCustomElementSource } from '../registry/local.js';
import { stripExample } from '../registry/example.js';
import { ensureTheme } from '../utils/theme.js';

export const add = new Command()
  .name('add')
  .description('Add one or more components to your project')
  .argument('[components...]', 'component names (e.g. button card dialog)')
  .option('-c, --cwd <cwd>', 'the working directory', process.cwd())
  .option('-y, --yes', 'skip overwrite prompts', false)
  .option('-o, --overwrite', 'overwrite existing files without asking', false)
  .option('--no-deps', 'skip installing npm dependencies')
  .option('--registry <url>', 'registry base URL', DEFAULT_REGISTRY_URL)
  .action(async (components, opts) => {
    const cwd = opts.cwd;
    const config = getConfig(cwd);
    if (!config) {
      logger.error(`No ${logger.cyan('components.json')} found in ${cwd}.`);
      logger.info(`Run ${logger.cyan('npx @webjsdev/ui init')} first.`);
      process.exit(1);
    }

    if (!components || components.length === 0) {
      logger.error('No components specified.');
      logger.info(`Try ${logger.cyan('npx @webjsdev/ui add button')} or ${logger.cyan('npx @webjsdev/ui list')}.`);
      process.exit(1);
    }

    const tree = await resolveTree(components, opts.registry);
    logger.info(`Installing ${logger.bold(components.join(', '))}…`);

    // Self-heal missing theme tokens (#983): the helpers render against CSS
    // design tokens; if the app never ran (or lost) the theme block, plant it
    // so a copied component is not unstyled. Idempotent when already present.
    // Skip if the config predates / lacks the tailwind fields (never crash add).
    const tw = config.tailwind || {};
    if (tw.css && tw.baseColor) {
      const theme = await ensureTheme(cwd, tw.baseColor, tw.css, opts.registry);
      if (theme.status === 'written') {
        logger.success(`Planted missing theme tokens into ${tw.css}`);
      } else if (theme.status === 'failed') {
        logger.warn(`Could not verify theme tokens in ${tw.css}: ${theme.error}`);
      }
    }

    for (const item of tree) {
      for (const file of item.files || []) {
        await writeRegistryFile(cwd, config, item, file, opts);
      }
    }

    if (opts.deps !== false) {
      const { dependencies, devDependencies } = collectNpmDeps(tree);
      // @webjsdev/core is always a runtime dep
      if (!dependencies.includes('@webjsdev/core')) dependencies.push('@webjsdev/core');

      if (dependencies.length) await installDeps(cwd, dependencies, false);
      if (devDependencies.length) await installDeps(cwd, devDependencies, true);
    }

    logger.success('Done.');
  });

async function writeRegistryFile(cwd, config, item, file, opts) {
  const target = resolveTarget(cwd, config, item, file);
  ensureDir(dirname(target));

  // The shared helpers are yours to edit, and since #1129 they live at the
  // `utils` alias, which is the file `webjs create` generates and the one the
  // docs tell you to retune. `--yes` means "do not ask me about overwrites",
  // which is the normal non-interactive invocation, so honouring it here would
  // replace edited source on every `add`. Only an explicit `--overwrite` may.
  if (existsSync(target) && !opts.overwrite && helperTarget(config, item, file)) {
    logger.info(`${relative(cwd, target)} already exists: keeping it.`);
    return;
  }

  if (existsSync(target) && !opts.overwrite && !opts.yes) {
    const r = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: `Overwrite ${basename(target)}?`,
      initial: false,
    });
    if (!r.overwrite) {
      logger.info(`Skipped ${basename(target)}`);
      return;
    }
  }

  const content = transformForProject(file.content || '', target, config, item);
  writeFileSync(target, content, 'utf8');
  logger.success(`Wrote ${relative(cwd, target)}`);
}

/**
 * The single transform that turns a registry file's raw content into what
 * lands in the user's project. `add` writes this; `diff` compares against it,
 * so the two cannot disagree (#983). Two steps:
 *
 *  1. Retarget the registry-relative `../lib/utils.ts` / `../lib/dom.ts` imports
 *     to the project's resolved helper paths (see {@link rewriteUtilsImport}).
 *  2. For a Tier-1 helper component (a `registry:ui` file that is NOT a custom
 *     element), strip the worked `@example` and leave a one-line pointer, so the
 *     copied file keeps only the helpers + a lean header. Tier-2 custom-element
 *     files are left whole (the element IS the component), and lib/theme files
 *     have no example so the strip is a no-op.
 *
 * @param {string} content raw registry file content
 * @param {string} target absolute path where the file will be written
 * @param {{ resolvedPaths: { utils: string } }} config parsed components.json
 * @param {{ name: string, type?: string }} [item] the registry item
 * @returns {string}
 */
export function transformForProject(content, target, config, item) {
  let out = rewriteUtilsImport(content, target, config);
  if (item && item.type === 'registry:ui' && !isCustomElementSource(content)) {
    out = stripExample(out, item.name);
  }
  return out;
}

/**
 * Rewrite the registry-relative `'../lib/utils.ts'` and `'../lib/dom.ts'`
 * imports to the paths that resolve correctly from the file's target
 * location to the user's cn() helper and onBeforeCache() DOM helper.
 *
 * The registry source assumes its own layout (`<registry>/components/<x>.ts`
 * imports `'../lib/utils.ts'` / `'../lib/dom.ts'`). When that file lands in
 * the user's components/ui/<x>.ts, the literal `'../lib/utils.ts'` resolves
 * to `components/lib/utils.ts`, which doesn't exist. We compute the actual
 * relative path from the target directory to the user's configured helper
 * (`config.resolvedPaths.utils`, from components.json's aliases.utils) and
 * substitute it in. The DOM helper is written as a SIBLING of the utils
 * file (the scaffold puts it at `lib/utils/dom.ts`, next to `cn.ts`), so its
 * absolute target is `dom.ts` in the utils file's directory. sonner imports
 * ONLY the DOM helper, so both specifiers are handled independently and
 * neither presence gates the other.
 *
 * @param {string} content raw file content from the registry
 * @param {string} target absolute path where the file will be written
 * @param {{ resolvedPaths: { utils: string } }} config parsed components.json
 */
export function rewriteUtilsImport(content, target, config) {
  const utilsAbs = config?.resolvedPaths?.utils;
  if (!utilsAbs) return content;
  let out = replaceImportSpecifier(content, '../lib/utils.ts', utilsAbs, target);
  const domAbs = join(dirname(utilsAbs), 'dom.ts');
  out = replaceImportSpecifier(out, '../lib/dom.ts', domAbs, target);
  return out;
}

/**
 * Replace a single registry-relative import specifier with the relative path
 * from `target`'s directory to `destAbs`. No-op when `spec` is absent.
 *
 * @param {string} content
 * @param {string} spec the registry-relative specifier to replace
 * @param {string} destAbs absolute path of the destination file
 * @param {string} target absolute path where the importing file is written
 */
function replaceImportSpecifier(content, spec, destAbs, target) {
  if (!content.includes(spec)) return content;
  let rel = relPath(dirname(target), destAbs).split(/[\\/]/).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return content
    .replaceAll(`'${spec}'`, `'${rel}'`)
    .replaceAll(`"${spec}"`, `"${rel}"`);
}

function resolveTarget(cwd, config, item, file) {
  // The two shared helpers are pinned to `lib/utils.ts` / `lib/dom.ts` by the
  // registry manifest, but where they actually BELONG is wherever the project's
  // `utils` alias points, because that is the path `rewriteUtilsImport` writes
  // into every component's import. Honour the alias for them, ahead of the
  // manifest target, or `add` writes a second copy at the pinned path that
  // nothing imports while the components resolve to the aliased one.
  // The dom helper is the utils file's SIBLING, the same relationship the
  // rewrite assumes, so the two cannot disagree.
  const helper = helperTarget(config, item, file);
  if (helper) return helper;

  // explicit `target` wins
  if (file.target) return join(cwd, file.target);

  const fileName = basename(file.path);
  const aliases = config.aliases;

  switch (file.type) {
    case 'registry:ui':
      return join(cwd, (aliases.ui || 'components/ui').replace(/^@\//, ''), fileName);
    case 'registry:component':
      return join(cwd, aliases.components.replace(/^@\//, ''), fileName);
    case 'registry:lib':
      return join(cwd, (aliases.lib || 'lib').replace(/^@\//, ''), fileName);
    case 'registry:hook':
      return join(cwd, 'hooks', fileName);
    default:
      return join(cwd, fileName);
  }
}

/**
 * Absolute target for the `lib-utils` / `lib-dom` registry items, derived from
 * the project's configured `utils` alias, or null for anything else.
 *
 * Kept as the single place that answers "where do the shared helpers live",
 * so `add`'s WRITE and {@link rewriteUtilsImport}'s REWRITE read the same
 * answer. `init` writes the same two paths (see `init.js` `writeLibUtils`).
 *
 * @param {{ resolvedPaths?: { utils?: string } }} config parsed components.json
 * @param {{ name?: string }} [item] the registry item
 * @param {{ path?: string }} [file] the file within that item
 * @returns {string | null}
 */
function helperTarget(config, item, file) {
  const utilsAbs = config?.resolvedPaths?.utils;
  if (!utilsAbs || !item) return null;
  // Matched per FILE, not per item. `rewriteUtilsImport` always retargets
  // component imports to `resolvedPaths.utils`, so the ONE file those imports
  // resolve to has to be written there or it is an orphan. Any other file a
  // custom registry ships under the same item is not that file, so it keeps
  // its manifest target: routing them all here would collapse them onto one
  // path and lose every file but the last.
  if (!file) return null;
  const name = basename(file.path || '');
  if (item.name === 'lib-utils' && name === 'utils.ts') return utilsAbs;
  if (item.name === 'lib-dom' && name === 'dom.ts') return join(dirname(utilsAbs), 'dom.ts');
  return null;
}

function relative(cwd, p) {
  return p.startsWith(cwd) ? p.slice(cwd.length + 1) : p;
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

async function installDeps(cwd, deps, dev) {
  const manager = detectPackageManager(cwd);
  const flag = dev ? '-D' : '';
  const cmd = `${manager.exec} ${manager.add} ${flag} ${deps.join(' ')}`.replace(/\s+/g, ' ').trim();
  logger.info(`${logger.dim('$')} ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (e) {
    logger.warn(`Dependency install failed. Run manually: ${logger.cyan(cmd)}`);
  }
}

function detectPackageManager(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return { exec: 'pnpm', add: 'add' };
  if (existsSync(join(cwd, 'yarn.lock'))) return { exec: 'yarn', add: 'add' };
  if (existsSync(join(cwd, 'bun.lockb'))) return { exec: 'bun', add: 'add' };
  return { exec: 'npm', add: 'install' };
}
