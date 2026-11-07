// Loads dist/extension.js against a minimal stub of the `vscode` module and
// checks that activation registers every contributed command. This catches
// bundling/import errors without a VS Code instance.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const os = require('os');

const registered = new Set();
const noop = () => {};
const disposable = { dispose: noop };
const emitter = class { constructor() { this.event = () => disposable; } fire() {} dispose() {} };
const vscode = {
  window: {
    createOutputChannel: () => ({ info: noop, warn: noop, error: noop, debug: noop, show: noop, dispose: noop }),
    createStatusBarItem: () => ({ show: noop, dispose: noop }),
    registerWebviewPanelSerializer: () => disposable,
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    state: { focused: true },
  },
  commands: { registerCommand: (id) => (registered.add(id), disposable) },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k === 'autoStart' ? false : d) }),
    onDidChangeConfiguration: () => disposable,
    workspaceFolders: [],
  },
  env: { clipboard: { readText: async () => '', writeText: async () => {} } },
  Uri: { joinPath: (u, ...p) => ({ fsPath: path.join(u.fsPath, ...p) }), file: (f) => ({ fsPath: f }) },
  EventEmitter: emitter,
  StatusBarAlignment: { Left: 1 },
  ViewColumn: { Active: -1, Beside: -2 },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Separator: -1 },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : load.call(this, request, ...rest);
};

const root = path.resolve(__dirname, '..');
const ext = require(path.join(root, 'dist/extension.js'));
const ctx = {
  subscriptions: [],
  extensionUri: { fsPath: root },
  globalStorageUri: { fsPath: path.join(os.tmpdir(), `easygui-activation-${process.pid}`) },
  globalState: { get: (_k, d) => d, update: async () => {} },
  environmentVariableCollection: { clear: noop, replace: noop },
};
ext.activate(ctx);
const contributed = require(path.join(root, 'package.json')).contributes.commands.map((c) => c.command);
for (const id of contributed) assert.ok(registered.has(id), `command ${id} is registered`);
ext.deactivate();
console.log(`PASS activation registers ${contributed.length} commands`);
