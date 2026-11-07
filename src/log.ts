// The extension's log (the "EasyGUI" output channel) and the "Show Logs" command.
// 拡張機能のログ（出力パネルの「EasyGUI」）と「Show Logs」コマンド。
import * as fs from 'fs';
import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | null = null;

export function initLog(): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel('EasyGUI', { log: true });
  return channel;
}

export const log = {
  info: (m: string): void => channel?.info(m),
  error: (m: string): void => channel?.error(m),
  debug: (m: string): void => channel?.debug(m),
};

/**
 * Shows the extension's log with the path of the xpra server log, and opens that log.
 * 拡張機能のログと xpra サーバのログの場所を表示し、そのログを開く。
 */
export function showLogs(serverLog: string): void {
  channel?.show(true);
  log.info(`xpra server log: ${serverLog}`);
  if (fs.existsSync(serverLog)) void vscode.window.showTextDocument(vscode.Uri.file(serverLog), { preview: true });
}
