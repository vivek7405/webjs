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
        // Mirrors the CLI's own rule (`packages/cli/lib/app-name.js`, #1066).
        // This box REFUSES at the prompt, so anything stricter than the CLI
        // blocks a name `webjs create` would happily take. It accepted only
        // lowercase and dashes, which rejected `MyApp`, `my.app` and `my_app`.
        validateInput: (v) =>
          /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)
            ? null
            : 'letters, digits, and - . _ , starting with a letter or a digit',
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

module.exports = { activate, deactivate };
