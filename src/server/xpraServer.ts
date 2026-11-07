// Starts, reuses and stops the xpra server (which in turn starts Xvfb and
// serves the HTML5 client). The server runs as a detached process so that GUI
// applications survive extension host restarts (window reloads, remote
// reconnects); the extension finds it again through the state file in the
// per-user run directory.
// xpra サーバ（Xvfb の起動と HTML5 クライアントの配信も行う）を起動・再利用・停止する。
// サーバは切り離したプロセスとして動くので、拡張ホストが再起動しても（ウィンドウの再読み込み、
// リモートの再接続）GUI アプリは終了しない。再起動後は、ユーザーごとの作業ディレクトリにある
// 状態ファイルから既存のサーバを見つける。
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Runtime } from '../runtime/bundle';
import { alive, canConnect, freePort, pickDisplay } from './probe';
import { xpraArgs, xpraEnv } from './xpraConfig';

/** A running server, as saved in the state file. / 状態ファイルに保存する、動作中のサーバの情報。 */
export interface ServerState {
  pid: number;
  display: number;
  /** TCP port on 127.0.0.1 for the HTML5 client's WebSocket. / HTML5 クライアントの WebSocket 用ポート（127.0.0.1）。 */
  port: number;
  /** Password the WebSocket connection must give. / WebSocket 接続に必要なパスワード。 */
  password: string;
  xauthority: string;
  /** The runtime the server was started from. / サーバを起動した配布物。 */
  runtimeDir: string;
}

export interface StartOptions {
  runtime: Runtime;
  /** 0 = pick a free display number starting at 100. / 0 は :100 以降の空き番号を選ぶ。 */
  display: number;
  logFile: string;
  dpi: number;
  log: (m: string) => void;
}

/**
 * The per-user run directory (0700): state file, password, Xauthority.
 * ユーザーごとの作業ディレクトリ（0700）: 状態ファイル、パスワード、Xauthority を置く。
 */
export function runDir(uid: number): string {
  const dir = `/tmp/vscode-easygui-${uid}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.statSync(dir);
  if (st.uid !== uid) throw new Error(`${dir} is owned by another user`);
  fs.chmodSync(dir, 0o700);
  return dir;
}

export class XpraServer {
  readonly stateFile: string;

  constructor(readonly runDirectory: string) {
    this.stateFile = path.join(runDirectory, 'state.json');
  }

  readState(): ServerState | null {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * The state of a running server of this runtime that can be reused, or null.
   * この配布物で動いていて再利用できるサーバの状態。無ければ null。
   */
  async findRunning(runtime: Runtime): Promise<ServerState | null> {
    const st = this.readState();
    if (!st) return null;
    if (st.runtimeDir !== runtime.dir || !alive(st.pid) || !(await canConnect(st.port))) {
      if (!alive(st.pid)) fs.rmSync(this.stateFile, { force: true });
      return null;
    }
    return st;
  }

  /**
   * Starts a new server and waits until it is ready.
   * 新しいサーバを起動し、準備ができるまで待つ。
   */
  async start(o: StartOptions): Promise<ServerState> {
    const dir = this.runDirectory;
    const display = pickDisplay(o.display);
    const port = await freePort();
    // A new random password for every start, readable only by this user.
    // 起動のたびに新しい乱数のパスワードを作り、このユーザーだけが読めるようにする。
    const password = randomBytes(24).toString('hex');
    const passwordFile = path.join(dir, 'password');
    fs.writeFileSync(passwordFile, password, { mode: 0o600 });
    // xpra adds its cookie to an existing XAUTHORITY file; create it so it is not ~/.Xauthority.
    // xpra は既存の XAUTHORITY ファイルに cookie を追加する。~/.Xauthority を使わないよう先に作っておく。
    const xauthority = path.join(dir, 'Xauthority');
    if (!fs.existsSync(xauthority)) fs.writeFileSync(xauthority, '', { mode: 0o600 });
    const xdgRuntime = path.join(dir, 'xdg');
    fs.mkdirSync(xdgRuntime, { recursive: true, mode: 0o700 });

    const xpra = path.join(o.runtime.dir, 'bin', 'xpra');
    const args = xpraArgs({ bundleDir: o.runtime.dir, display, port, passwordFile, xauthority, runDir: dir, dpi: o.dpi });
    fs.mkdirSync(path.dirname(o.logFile), { recursive: true });
    const out = fs.openSync(o.logFile, 'a');
    fs.writeSync(out, `\n=== ${new Date().toISOString()} starting xpra on :${display}, port ${port}\n${xpra} ${args.join(' ')}\n`);
    const logStart = fs.fstatSync(out).size;
    const child = spawn(xpra, args, { env: xpraEnv(process.env, xauthority, xdgRuntime), cwd: dir, detached: true, stdio: ['ignore', out, out] });
    fs.closeSync(out);
    child.unref();
    const pid = child.pid;
    if (!pid) throw new Error('Failed to spawn the xpra server process.');
    let exited: number | null = null;
    child.once('exit', (code) => (exited = code ?? -1));

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (exited !== null) throw new Error(`xpra exited during startup (code ${exited}). See the backend log:\n${tail(o.logFile, 25)}`);
      // The TCP socket is bound before the display exists; wait for the ready message of this run.
      // TCP ソケットはディスプレイより先にできるので、今回の起動の「準備完了」メッセージを待つ。
      if (/xpra is ready/.test(readFrom(o.logFile, logStart)) && (await canConnect(port))) {
        const st: ServerState = { pid, display, port, password, xauthority, runtimeDir: o.runtime.dir };
        fs.writeFileSync(this.stateFile, JSON.stringify(st, null, 2), { mode: 0o600 });
        o.log(`xpra server started (pid ${pid}) on display :${display}, HTML5 client on 127.0.0.1:${port}`);
        return st;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch { /* ignore / 無視 */ }
    throw new Error(`Timed out waiting for the xpra server to start. See the backend log:\n${tail(o.logFile, 25)}`);
  }

  /**
   * Stops the server (the whole process group: xpra and Xvfb).
   * サーバを停止する（xpra と Xvfb を含むプロセスグループごと）。
   */
  async stop(log: (m: string) => void): Promise<void> {
    const st = this.readState();
    if (!st) return;
    if (alive(st.pid)) {
      log(`stopping xpra server (pid ${st.pid})`);
      try {
        process.kill(-st.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(st.pid, 'SIGTERM');
        } catch { /* already gone / すでに終了している */ }
      }
      for (let i = 0; i < 50 && alive(st.pid); i++) await new Promise((r) => setTimeout(r, 100));
      if (alive(st.pid)) {
        try {
          process.kill(-st.pid, 'SIGKILL');
        } catch { /* ignore / 無視 */ }
      }
    }
    fs.rmSync(this.stateFile, { force: true });
  }
}

/** The part of a file written after offset. / ファイルの offset 以降に書かれた部分。 */
function readFrom(file: string, offset: number): string {
  try {
    return fs.readFileSync(file).subarray(offset).toString('utf8');
  } catch {
    return '';
  }
}

/** The last lines of a file. / ファイルの末尾の数行。 */
function tail(file: string, lines: number): string {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}
