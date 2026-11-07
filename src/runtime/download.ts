// Downloads a file over HTTPS and checks its SHA-256 while writing it.
// HTTPS でファイルをダウンロードし、書き込みながら SHA-256 を照合する。
import { createHash } from 'crypto';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';

/**
 * GET with redirects (GitHub release assets redirect to their storage host).
 * リダイレクトをたどる GET（GitHub の Release のファイルは保存先のホストへ転送される）。
 */
function get(url: string, redirects = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'easygui-devcontainer' } }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && redirects > 0) {
          res.resume();
          resolve(get(new URL(loc, url).toString(), redirects - 1));
        } else if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Downloading ${url} failed: HTTP ${res.statusCode}`));
        } else {
          resolve(res);
        }
      })
      .on('error', (e) => reject(new Error(`Downloading ${url} failed: ${e.message}`)));
  });
}

/**
 * Downloads url to file and fails unless its SHA-256 is sha256.
 * url を file にダウンロードし、SHA-256 が sha256 と一致しなければ失敗にする。
 */
export async function downloadVerified(url: string, sha256: string, file: string, progress: (message: string) => void): Promise<void> {
  progress(`Downloading ${url}`);
  const res = await get(url);
  const total = Number(res.headers['content-length']) || 0;
  const hash = createHash('sha256');
  const out = fs.createWriteStream(file);
  let received = 0;
  let reported = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    hash.update(chunk);
    received += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    // Report every MB. / 1 MB ごとに進み具合を知らせる。
    if (received - reported > 2 ** 20) {
      reported = received;
      progress(`Downloading: ${(received / 2 ** 20).toFixed(0)}${total ? ` / ${(total / 2 ** 20).toFixed(0)}` : ''} MB`);
    }
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  const actual = hash.digest('hex');
  if (actual !== sha256) throw new Error(`The downloaded runtime does not match its pinned SHA-256 (got ${actual}).`);
}
