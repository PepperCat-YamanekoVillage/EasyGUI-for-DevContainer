// The status bar item: shows the session's state and opens the display tab when clicked.
// ステータスバーの項目: セッションの状態を表示し、クリックで表示タブを開く。
import * as vscode from 'vscode';

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

  constructor() {
    this.item.command = 'easyGui.start';
    this.stopped();
    this.item.show();
  }

  stopped(): void {
    this.set('$(circle-slash) EasyGUI', 'EasyGUI: stopped. Click to start and show the display.');
  }

  notInstalled(): void {
    this.set('$(circle-slash) EasyGUI', 'EasyGUI: the Xpra runtime is not installed. Click to install and start.');
  }

  starting(): void {
    this.set('$(sync~spin) EasyGUI', 'EasyGUI: starting the display server...');
  }

  running(display: number): void {
    this.set('$(device-desktop) EasyGUI', `EasyGUI: running on display :${display}. Click to show it.`);
  }

  failed(message: string): void {
    this.set('$(warning) EasyGUI', `EasyGUI: ${message}`);
  }

  dispose(): void {
    this.item.dispose();
  }

  private set(text: string, tooltip: string): void {
    this.item.text = text;
    this.item.tooltip = tooltip;
  }
}
