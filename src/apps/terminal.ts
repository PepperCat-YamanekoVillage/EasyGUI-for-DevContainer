// Sets DISPLAY and friends in new integrated terminals (easyGui.terminalEnvironment),
// so GUI applications started there appear on the display.
// 新しく開く統合ターミナルに DISPLAY などを設定する（easyGui.terminalEnvironment）。
// そこで起動した GUI アプリがディスプレイに表示されるようにするため。
import * as vscode from 'vscode';

/** Where applications draw. / アプリの描画先。 */
export interface DisplayEnv {
  DISPLAY: string;
  XAUTHORITY: string;
}

/**
 * Applies the display's variables to new terminals, or clears them (display null or setting off).
 * ディスプレイの変数を新しいターミナルに設定する。display が null か設定が無効なら消す。
 */
export function applyTerminalEnvironment(coll: vscode.GlobalEnvironmentVariableCollection, display: DisplayEnv | null): void {
  coll.clear();
  if (!display || !vscode.workspace.getConfiguration('easyGui').get<boolean>('terminalEnvironment', true)) return;
  coll.description = `EasyGUI display ${display.DISPLAY}`;
  coll.persistent = false;
  coll.replace('DISPLAY', display.DISPLAY);
  coll.replace('XAUTHORITY', display.XAUTHORITY);
  // Make toolkits pick X11 even if the container sets them up for Wayland.
  // コンテナが Wayland 向けの設定でも、ツールキットが X11 を選ぶようにする。
  coll.replace('GDK_BACKEND', 'x11');
  coll.replace('QT_QPA_PLATFORM', 'xcb');
}
