// One EasyGUI session: gets the runtime, starts (or reuses) the xpra server
// and the client proxy in front of it, and keeps the display tab, the status
// bar and the terminal variables in step with it.
// EasyGUI のセッション: 実行環境を用意し、xpra サーバとその手前の中継サーバを起動
// （または再利用）して、表示タブ・ステータスバー・ターミナルの変数をその状態に合わせる。
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DisplayEnv, applyTerminalEnvironment } from './apps/terminal';
import { DisplayPanel, DisplayTarget } from './display/panel';
import { ClientProxy } from './display/proxy';
import { log, showLogs } from './log';
import { UnsupportedPlatformError, checkPlatform, loadRuntime } from './runtime/bundle';
import { promptAndInstall } from './runtime/installPrompt';
import { ServerState, XpraServer, runDir } from './server/xpraServer';
import { StatusBar } from './statusBar';

export class Session implements vscode.Disposable {
  readonly panel = new DisplayPanel();
  private readonly status = new StatusBar();
  private readonly proxy = new ClientProxy();
  private readonly storage: string;
  private server: XpraServer | null = null;
  private state: ServerState | null = null;
  /** What the display tab connects to: the client proxy in front of xpra. / 表示タブの接続先（xpra の手前の中継サーバ）。 */
  private target: DisplayTarget | null = null;
  private starting: Promise<ServerState | null> | null = null;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.storage = ctx.globalStorageUri.fsPath;
    fs.mkdirSync(path.join(this.storage, 'logs'), { recursive: true });
  }

  private get serverLog(): string {
    return path.join(this.storage, 'logs', 'xpra.log');
  }

  /** The server for this user's run directory. / このユーザーの作業ディレクトリのサーバ。 */
  private getServer(): XpraServer {
    return (this.server ??= new XpraServer(runDir(process.getuid?.() ?? 0)));
  }

  /**
   * Starts (or finds) the server; null if it is not available. Concurrent calls share one start.
   * サーバを起動する（動いていれば見つける）。使えなければ null。同時に呼ばれても起動は 1 回だけ。
   */
  ensureStarted(interactive: boolean): Promise<ServerState | null> {
    if (this.state) return Promise.resolve(this.state);
    this.starting ??= this.doStart(interactive).finally(() => (this.starting = null));
    return this.starting;
  }

  /** Starts the server if needed and shows the display tab. / 必要ならサーバを起動し、表示タブを開く。 */
  async show(): Promise<void> {
    const st = await this.ensureStarted(true);
    if (st && this.target) await this.panel.show(this.target);
  }

  private async doStart(interactive: boolean): Promise<ServerState | null> {
    this.status.starting();
    try {
      const bundle = checkPlatform();
      const rt = loadRuntime(this.storage, bundle) ?? (await promptAndInstall(this.storage, bundle, interactive));
      if (!rt) {
        this.status.notInstalled();
        return null;
      }
      let st = await this.getServer().findRunning(rt);
      if (st) log.info(`reusing running xpra server (pid ${st.pid}) on :${st.display}`);
      else {
        const cfg = vscode.workspace.getConfiguration('easyGui');
        st = await this.getServer().start({ runtime: rt, display: cfg.get('displayNumber', 0), logFile: this.serverLog, dpi: cfg.get('dpi', 96), log: (m) => log.info(m) });
      }
      const proxyPort = await this.proxy.start(path.join(rt.dir, 'usr/share/xpra/www'), st.port);
      this.target = { display: st.display, port: proxyPort, password: st.password };
      this.state = st;
      applyTerminalEnvironment(this.ctx.environmentVariableCollection, this.displayEnv());
      await this.panel.setTarget(this.target);
      this.status.running(st.display);
      return st;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(msg);
      const unsupported = e instanceof UnsupportedPlatformError;
      this.status.failed(msg);
      // An unsupported container is only reported when asked to start.
      // 対応していないコンテナのことは、起動を頼まれたときだけ知らせる。
      if (interactive || !unsupported) {
        const action = await vscode.window.showErrorMessage(`EasyGUI ${unsupported ? 'cannot run here' : 'failed to start'}: ${msg.split('\n')[0]}`, 'Show Logs');
        if (action) this.showLogs();
      }
      return null;
    }
  }

  async stop(): Promise<void> {
    await this.getServer().stop((m) => log.info(m));
    this.state = null;
    this.target = null;
    this.proxy.dispose();
    applyTerminalEnvironment(this.ctx.environmentVariableCollection, null);
    await this.panel.setTarget(null);
    this.status.stopped();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.show();
  }

  showLogs(): void {
    showLogs(this.serverLog);
  }

  /** Re-applies settings that take effect immediately. / すぐ反映する設定を適用し直す。 */
  onConfigChanged(): void {
    applyTerminalEnvironment(this.ctx.environmentVariableCollection, this.displayEnv());
  }

  private displayEnv(): DisplayEnv | null {
    return this.state ? { DISPLAY: `:${this.state.display}`, XAUTHORITY: this.state.xauthority } : null;
  }

  dispose(): void {
    this.status.dispose();
    this.panel.dispose();
    this.proxy.dispose();
  }
}
