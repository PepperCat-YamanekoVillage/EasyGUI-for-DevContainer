// Entry point: registers the commands, the display tab's restore handler and
// the settings listener, and starts the session when the window opens.
// 入口: コマンド、表示タブの復元処理、設定変更の監視を登録し、ウィンドウが開いたらセッションを始める。
import * as vscode from 'vscode';
import { VIEW_TYPE } from './display/panel';
import { initLog } from './log';
import { Session } from './session';

export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(initLog());
  const s = new Session(ctx);
  ctx.subscriptions.push(
    s,
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (panel) => {
        s.panel.adopt(panel);
        await s.ensureStarted(false);
      },
    }),
    vscode.commands.registerCommand('easyGui.start', () => s.show()),
    vscode.commands.registerCommand('easyGui.stop', () => s.stop()),
    vscode.commands.registerCommand('easyGui.restart', () => s.restart()),
    vscode.commands.registerCommand('easyGui.showLogs', () => s.showLogs()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('easyGui')) s.onConfigChanged();
    }),
  );
  if (vscode.workspace.getConfiguration('easyGui').get<boolean>('autoStart', true)) void s.ensureStarted(false);
}

// The xpra server keeps running on deactivation so applications survive window reloads.
// 終了時も xpra サーバは止めない。ウィンドウを再読み込みしてもアプリが残るようにするため。
export function deactivate(): void {}
