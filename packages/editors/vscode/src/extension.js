/**
 * The WebJs VSCode extension entry point (#382, phase 1 of #381).
 *
 * Most of the value is DECLARATIVE (the manifest's `contributes`): the
 * `html`/`css`/`svg` template grammars highlight embedded markup with no Lit
 * extension, the bundled `@webjsdev/intellisense` is auto-registered as a tsserver
 * plugin (no tsconfig edit), and the snippets ship the common recipes. This
 * file only wires the three commands. It is CommonJS because VSCode loads the
 * extension host in CommonJS; `vscode` is provided by the host (never bundled).
 *
 * @module extension
 */

const vscode = require('vscode');

/**
 * The CLI's app-name rule (`packages/cli/lib/app-name.js`, #1066), duplicated
 * here because the extension bundle cannot require `@webjsdev/cli` at runtime.
 * `test/extension.test.mjs` cross-checks this against the real `checkAppName`
 * over a name table, so the duplication cannot drift silently. It already did
 * once: this box kept a lowercase-only regex after the CLI dropped that clause,
 * and refused `my.app` / `my_app` for far longer.
 *
 * Being LOOSER than the CLI is a bug too, not a safe direction: a name this box
 * accepts is shelled straight out to `webjs create`, so anything it lets
 * through only fails later, in the terminal, which is what a prompt-time
 * validator exists to prevent.
 * @param {string} v
 * @returns {string | null} an error message, or null when the name is valid
 */
function validateAppName(v) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) {
    return 'letters, digits, and - . _ , starting with a letter or a digit';
  }
  if (v.length > 214) return 'at most 214 characters';
  if (['node_modules', 'favicon.ico'].includes(v.toLowerCase())) {
    return `"${v}" is reserved by npm`;
  }
  return null;
}

/** Open or reuse a terminal and run a command in the workspace root. */
function runInTerminal(name, command) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  const terminal = vscode.window.createTerminal({ name, cwd });
  terminal.show();
  terminal.sendText(command);
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('webjs.check', () => {
      runInTerminal('webjs check', 'npx webjs check');
    }),
    vscode.commands.registerCommand('webjs.create', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'New webjs app name',
        placeHolder: 'my-app',
        validateInput: validateAppName,
      });
      if (!name) return;
      runInTerminal('webjs create', `npx @webjsdev/cli create ${name}`);
    }),
    vscode.commands.registerCommand('webjs.docs', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://webjs.dev/docs'));
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, validateAppName };
