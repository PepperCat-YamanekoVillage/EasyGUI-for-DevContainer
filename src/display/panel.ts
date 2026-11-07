// The editor tab showing the container display: a webview that embeds the
// xpra HTML5 client in an iframe. The client's port is made reachable from the
// VS Code client with asExternalUri (which sets up port forwarding when VS Code
// is connected to a remote/container).
// コンテナのディスプレイを表示するエディタタブ: xpra の HTML5 クライアントを iframe で
// 埋め込んだ Webview。クライアントのポートは asExternalUri で VS Code 側から届くようにする
// （リモートやコンテナに接続しているときは、これで VS Code がポート転送を設定する）。
import * as vscode from 'vscode';
import { clientPath } from '../server/xpraConfig';

export const VIEW_TYPE = 'easyGui.display';
const TITLE = 'EasyGUI';

/** What the tab connects to. / タブの接続先。 */
export interface DisplayTarget {
  display: number;
  /** Port on 127.0.0.1 serving the HTML5 client. / HTML5 クライアントを配信する 127.0.0.1 のポート。 */
  port: number;
  password: string;
}

export class DisplayPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private target: DisplayTarget | null = null;

  /** Opens (or reveals) the display tab. / 表示タブを開く（開いていれば前面に出す）。 */
  async show(target: DisplayTarget, preserveFocus = false): Promise<void> {
    if (!this.panel) {
      const options = { enableScripts: true, retainContextWhenHidden: true };
      this.adopt(vscode.window.createWebviewPanel(VIEW_TYPE, TITLE, { viewColumn: vscode.ViewColumn.Active, preserveFocus }, options));
    } else if (!this.panel.visible || !preserveFocus) {
      this.panel.reveal(undefined, preserveFocus);
    }
    await this.setTarget(target);
  }

  /**
   * Takes over a tab restored by VS Code after a window reload.
   * ウィンドウの再読み込み後に VS Code が復元したタブを引き継ぐ。
   */
  adopt(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.target = null;
    // A restored tab keeps its old title. / 復元したタブは前の名前のままなので付け直す。
    panel.title = TITLE;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = page('Starting the display server...');
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = null;
    });
  }

  /**
   * Points an open tab at the given target, or shows "stopped" for null (no-op when no tab is open).
   * 開いているタブを接続先に向ける。null なら「停止中」を表示する（タブが無ければ何もしない）。
   */
  async setTarget(target: DisplayTarget | null): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    if (!target) {
      this.target = null;
      panel.webview.html = page('The display server is stopped. Run "EasyGUI: Start" to start it.');
      return;
    }
    if (this.target && this.target.port === target.port && this.target.password === target.password) return;
    this.target = target;
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${target.port}/`));
    panel.webview.html = page('', `${external.toString(true).replace(/\/?$/, '/')}${clientPath(target)}`);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

/**
 * The webview's HTML: the client in a full-size iframe, or a message.
 * Webview の HTML: 全面に広げた iframe のクライアント、またはメッセージ。
 */
function page(message: string, src?: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const origin = src ? new URL(src).origin : '';
  const csp = `default-src 'none'; style-src 'unsafe-inline';${origin ? ` frame-src ${origin};` : ''}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}
iframe{border:0;width:100%;height:100%;display:block}
p{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:1em}</style>
</head><body>${src ? `<iframe src="${esc(src)}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>` : `<p>${esc(message)}</p>`}</body></html>`;
}
