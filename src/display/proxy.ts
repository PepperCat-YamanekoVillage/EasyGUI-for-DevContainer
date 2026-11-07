// Serves the HTML5 client to the display tab and relays its WebSocket to xpra.
// xpra's own HTTP server closes the connection after every response; VS Code's
// port forwarding (seen over SSH) then loses the tail of large files when
// several load at once, and the client breaks. Node keeps connections alive,
// so the files arrive whole; the WebSocket is passed through to xpra as is.
// 表示タブに HTML5 クライアントを配信し、その WebSocket を xpra へ中継する。
// xpra 自身の HTTP サーバは応答のたびに接続を閉じる。すると VS Code のポート転送（SSH 越しで
// 確認）が、同時に読み込む大きなファイルの途中を落とし、クライアントが動かなくなる。Node は
// 接続を使い回す (keep-alive) ので、ファイルは欠けずに届く。WebSocket はそのまま xpra へ渡す。
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

/**
 * Whether the request names this machine (127.0.0.1 / localhost). A web page
 * that rebinds its own domain name to 127.0.0.1 (DNS rebinding) sends its
 * domain instead, and is refused.
 * リクエストがこのマシン（127.0.0.1 / localhost）宛てか。自分のドメイン名を 127.0.0.1 に
 * 向け直す Web ページ（DNS リバインディング）は、そのドメイン名を送ってくるので拒否する。
 */
function isLocalHost(req: http.IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost';
}

export class ClientProxy {
  private server: http.Server | null = null;
  private key = '';
  port = 0;

  /**
   * Starts (or keeps) the proxy for the given client files and xpra port; returns its port.
   * 指定したクライアントのファイルと xpra のポート用に中継サーバを起動し（同じなら使い続け）、そのポートを返す。
   */
  async start(wwwDir: string, xpraPort: number): Promise<number> {
    const key = `${wwwDir}:${xpraPort}`;
    if (this.server && this.key === key) return this.port;
    this.dispose();
    const root = path.resolve(wwwDir);
    // Static files, using the pre-gzipped copy when the browser accepts gzip.
    // 静的ファイル。ブラウザが gzip を受け付けるなら、圧縮済みのファイルを使う。
    const server = http.createServer((req, res) => {
      if (!isLocalHost(req)) {
        res.writeHead(403).end();
        return;
      }
      let file = '';
      try {
        const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        file = path.join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
      } catch {
        /* malformed URL: 404 below / 不正な URL: 下で 404 にする */
      }
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const headers: http.OutgoingHttpHeaders = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' };
      if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && fs.existsSync(`${file}.gz`)) {
        file += '.gz';
        headers['Content-Encoding'] = 'gzip';
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, { ...headers, 'Content-Length': body.length }).end(body);
    });
    // WebSocket: replay the upgrade request to xpra, then pipe both ways.
    // WebSocket: 接続切り替えの要求を xpra へそのまま送り、あとは双方向に流す。
    server.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      if (!isLocalHost(req)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = net.connect(xpraPort, '127.0.0.1', () => {
        let lines = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        upstream.write(`${lines}\r\n`);
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.server = server;
    this.key = key;
    this.port = (server.address() as net.AddressInfo).port;
    return this.port;
  }

  dispose(): void {
    this.server?.close();
    this.server?.closeAllConnections?.();
    this.server = null;
    this.key = '';
    this.port = 0;
  }
}
