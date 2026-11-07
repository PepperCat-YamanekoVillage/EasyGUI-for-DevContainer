// How EasyGUI runs xpra: the command-line options for xpra and its Xvfb, the
// environment, and the HTML5 client URL that matches those options.
// EasyGUI が xpra をどう動かすか: xpra と Xvfb のコマンドラインオプション、環境変数、
// それらに対応する HTML5 クライアントの URL。
import * as path from 'path';

export interface XpraConfig {
  /** Root of the unpacked runtime bundle. / 展開した配布物のルート。 */
  bundleDir: string;
  display: number;
  /** Port xpra listens on (127.0.0.1). / xpra が待ち受けるポート（127.0.0.1）。 */
  port: number;
  /** File holding the connection password. / 接続パスワードを書いたファイル。 */
  passwordFile: string;
  xauthority: string;
  /** Per-user run directory for xpra's sockets. / xpra のソケット用のユーザーごとの作業ディレクトリ。 */
  runDir: string;
  dpi: number;
}

/**
 * Arguments for the bundle's bin/xpra: a seamless server with a password-protected
 * TCP socket serving the HTML5 client, everything else off.
 * 配布物の bin/xpra に渡す引数: パスワード付き TCP ソケットで HTML5 クライアントを配信する
 * シームレスサーバ。それ以外の機能はすべて無効。
 */
export function xpraArgs(c: XpraConfig): string[] {
  // Xvfb with a large screen (xpra resizes it to the tab), started by the bundle's launcher.
  // 大きな画面の Xvfb（xpra がタブの大きさに合わせる）。配布物の起動用スクリプトで起動する。
  const xvfb = [
    path.join(c.bundleDir, 'bin', 'Xvfb'), '-screen', '0', '8192x4096x24+32', '+extension', 'GLX', '+extension', 'RANDR',
    '+extension', 'RENDER', '+extension', 'Composite', '-extension', 'DOUBLE-BUFFER', '-nolisten', 'tcp', '-noreset',
    '-auth', c.xauthority, '-dpi', `${c.dpi}x${c.dpi}`,
  ].join(' ');
  // Password auth from the file. As root, xpra also requires the client to send
  // the matching user name, which the HTML5 client does not: turn that off (the
  // per-start password is what protects the connection).
  // パスワードはファイルで確認する。root で動くと xpra はクライアントにユーザー名の一致も
  // 求めるが、HTML5 クライアントは送らないので無効にする（接続を守るのは起動ごとのパスワード）。
  const auth = `file(filename=${c.passwordFile},verify-username=no)`;
  return [
    'start', `:${c.display}`,
    '--daemon=no', '--bind=none', `--socket-dirs=${c.runDir}`, `--xvfb=${xvfb}`,
    `--bind-tcp=127.0.0.1:${c.port},auth=${auth}`, `--html=${path.join(c.bundleDir, 'usr/share/xpra/www')}`,
    '--mdns=no', '--audio=no', '--pulseaudio=no', '--notifications=no', '--dbus=no', '--systemd-run=no',
    '--webcam=no', '--printing=no', '--file-transfer=no', '--start-via-proxy=no', '--http-scripts=off',
    '--exit-with-children=no', '--exit-with-client=no', '--sharing=no', '--tray=no', '--system-tray=no',
    '--start-new-commands=no', '--opengl=no', `--dpi=${c.dpi}`, '--speaker=no', '--microphone=no',
  ];
}

/**
 * The environment for xpra, based on the extension host's.
 * xpra に渡す環境変数（拡張ホストのものを元にする）。
 */
export function xpraEnv(base: NodeJS.ProcessEnv, xauthority: string, xdgRuntimeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    XAUTHORITY: xauthority,
    XDG_RUNTIME_DIR: xdgRuntimeDir,
    // Ignore the obsolete WM_NORMAL_HINTS size field: xterm leaves a stale 10x17
    // there, which xpra would otherwise use as the initial window size.
    // 古い WM_NORMAL_HINTS の size 欄を無視させる。xterm はここに 10x17 を残していて、
    // そのままだと xpra がそれを最初のウィンドウサイズに使ってしまう。
    XPRA_SIZEHINTS_SIZE: '0',
  };
  // The bundle finds its libraries through RUNPATH; a container-wide
  // LD_LIBRARY_PATH would take precedence. Also keep the extension host's
  // Electron/Node settings out of xpra.
  // 配布物は RUNPATH でライブラリを見つける。コンテナ全体の LD_LIBRARY_PATH があると
  // そちらが優先されてしまう。拡張ホストの Electron / Node の設定も xpra に渡さない。
  for (const k of ['LD_LIBRARY_PATH', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete env[k];
  return env;
}

/**
 * Path and query of the HTML5 client page for a server with this password.
 * このパスワードのサーバにつなぐ HTML5 クライアントのページのパスとクエリ。
 */
export function clientPath(server: { password: string }): string {
  const params = new URLSearchParams({
    password: server.password,
    // The password is answered with an HMAC challenge response, and the
    // connection is local or tunnelled by VS Code, so plain ws:// is accepted.
    // パスワードは HMAC のチャレンジ応答で送られ、接続はローカルか VS Code の
    // トンネル経由なので、暗号化なしの ws:// を許可する。
    insecure: 'true',
    sound: 'false',
    printing: 'false',
    file_transfer: 'false',
  });
  return `index.html?${params}`;
}
