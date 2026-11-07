// Asks before downloading the runtime (easyGui.installRuntime) and shows the
// download's progress.
// 実行環境をダウンロードする前に確認し（easyGui.installRuntime）、ダウンロードの進み具合を表示する。
import * as vscode from 'vscode';
import { log } from '../log';
import { Bundle, RELEASE, Runtime, installRuntime } from './bundle';

/**
 * Installs the runtime if the settings and the user allow it; null otherwise.
 * 設定とユーザーが許可すれば実行環境を導入する。許可されなければ null。
 */
export async function promptAndInstall(storageDir: string, bundle: Bundle, interactive: boolean): Promise<Runtime | null> {
  const mode = vscode.workspace.getConfiguration('easyGui').get<string>('installRuntime', 'ask');
  if (mode === 'never') return null;
  if (mode === 'ask') {
    const choice = await vscode.window.showInformationMessage(
      'EasyGUI needs to download its display runtime (Xpra, about 35 MB, ~100 MB unpacked) from ' +
        'github.com/PepperCat-YamanekoVillage/xpra-runtime into the extension\'s storage. ' +
        'Nothing is installed into the container system or your project.',
      { modal: interactive },
      'Download',
    );
    if (choice !== 'Download') return null;
  }
  const rt = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'EasyGUI: installing the Xpra runtime' },
    (progress) =>
      installRuntime(storageDir, bundle, (m) => {
        progress.report({ message: m });
        log.debug(m);
      }),
  );
  log.info(`installed Xpra runtime ${RELEASE} (${bundle.arch}) in ${rt.dir}`);
  return rt;
}
