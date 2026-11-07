// Small checks used before and after starting the server: free TCP ports,
// free X display numbers, and whether a process or port is alive.
// サーバの起動前後に使う小さな確認処理: 空いている TCP ポート、空いている X の
// ディスプレイ番号、プロセスやポートが生きているか。
import * as fs from 'fs';
import * as net from 'net';

/**
 * Whether a process exists (EPERM: it exists but belongs to another user).
 * プロセスが存在するか（EPERM は「存在するが別ユーザーのもの」）。
 */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether something accepts TCP connections on 127.0.0.1:port.
 * 127.0.0.1:port で TCP 接続を受け付けているか。
 */
export function canConnect(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection(port, '127.0.0.1');
    const t = setTimeout(() => {
      s.destroy();
      resolve(false);
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(t);
      s.destroy();
      resolve(true);
    });
    s.once('error', () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/**
 * A TCP port on 127.0.0.1 that is free right now.
 * 127.0.0.1 で今空いている TCP ポート。
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function displayInUse(n: number): boolean {
  return fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`);
}

/**
 * The X display number to use: the configured one, or (0) the first free one from :100.
 * 使う X のディスプレイ番号: 設定された番号、または（0 のとき）:100 以降で最初に空いている番号。
 */
export function pickDisplay(preferred: number): number {
  if (preferred > 0) {
    if (displayInUse(preferred)) throw new Error(`Display :${preferred} is already in use (configured by easyGui.displayNumber).`);
    return preferred;
  }
  for (let n = 100; n < 200; n++) if (!displayInUse(n)) return n;
  throw new Error('No free X display number between :100 and :199.');
}
