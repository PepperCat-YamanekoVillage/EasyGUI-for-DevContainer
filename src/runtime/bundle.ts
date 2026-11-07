// The Xpra runtime: a self-contained bundle (xpra server, Xvfb, the HTML5
// client and every library they use; only glibc comes from the container)
// built by https://github.com/PepperCat-YamanekoVillage/xpra-runtime.
// It is downloaded once from a pinned release into the extension's storage,
// checked against the SHA-256 recorded here, and unpacked with tar. Nothing is
// written outside the storage directory.
// Xpra の実行環境: xpra-runtime がビルドする、必要なものをすべて含んだ配布物（xpra サーバ、
// Xvfb、HTML5 クライアントと、それらが使うライブラリ。glibc だけはコンテナのものを使う）。
// 固定した Release から拡張機能のストレージへ一度だけダウンロードし、ここに記録した SHA-256 と
// 照合して、tar で展開する。ストレージ以外には何も書き込まない。
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { downloadVerified } from './download';

/**
 * The xpra-runtime release used. To update, change it and the hashes below.
 * 使う xpra-runtime の Release。更新するときは、これと下のハッシュ値を書き換える。
 */
export const RELEASE = '2026-11-07-run2';
const BASE_URL = `https://github.com/PepperCat-YamanekoVillage/xpra-runtime/releases/download/${RELEASE}`;
const BUNDLES: Record<string, { arch: string; sha256: string }> = {
  x64: { arch: 'amd64', sha256: '4db370a6eb7087a64517069054016c2c3470ac5c3bb87c85b324a41ce1b8f414' },
  arm64: { arch: 'arm64', sha256: '7f0248c819658e9542b20698ffede7b714bc3ed71e92d391ef48f262ab861685' },
};
/**
 * The bundle is built from Debian 12 packages and uses the container's glibc.
 * 配布物は Debian 12 のパッケージから作られていて、コンテナの glibc を使う。
 */
const MIN_GLIBC = '2.36';

export class UnsupportedPlatformError extends Error {}

/** The bundle for this container. / このコンテナ用の配布物。 */
export interface Bundle {
  arch: string;
  url: string;
  sha256: string;
}

/** An unpacked bundle. / 展開済みの配布物。 */
export interface Runtime {
  /** Bundle root: bin/xpra, bin/Xvfb, usr/share/xpra/www, ... / 配布物のルート。 */
  dir: string;
}

function newerOrEqual(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < b.length; i++) if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  return true;
}

/**
 * The bundle for this container, or why it cannot run here.
 * このコンテナ用の配布物。動かせない場合は、その理由をエラーにする。
 */
export function checkPlatform(): Bundle {
  if (process.platform !== 'linux') {
    throw new UnsupportedPlatformError(`The extension host runs on ${process.platform}; EasyGUI only works inside Linux containers.`);
  }
  const b = BUNDLES[process.arch];
  if (!b) throw new UnsupportedPlatformError(`CPU architecture ${process.arch} is not supported (supported: x64, arm64).`);
  const glibc = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime;
  if (!glibc) throw new UnsupportedPlatformError('The container does not use glibc (e.g. Alpine/musl), which the Xpra runtime needs.');
  if (!newerOrEqual(glibc, MIN_GLIBC)) {
    throw new UnsupportedPlatformError(`The container's glibc ${glibc} is older than ${MIN_GLIBC}, which the Xpra runtime needs (e.g. Debian 12 / Ubuntu 24.04 or newer).`);
  }
  return { arch: b.arch, url: `${BASE_URL}/xpra-bundle-linux-${b.arch}.tar.gz`, sha256: b.sha256 };
}

function runtimeRoot(storageDir: string): string {
  return path.join(storageDir, 'runtime');
}

function runtimeDir(storageDir: string, b: Bundle): string {
  return path.join(runtimeRoot(storageDir), `${RELEASE}-${b.arch}`);
}

/**
 * The installed runtime, if this release is already unpacked.
 * この Release が展開済みなら、その実行環境。
 */
export function loadRuntime(storageDir: string, b: Bundle): Runtime | null {
  const dir = runtimeDir(storageDir, b);
  return fs.existsSync(path.join(dir, 'bin', 'xpra')) ? { dir } : null;
}

/**
 * Downloads, verifies and unpacks the bundle; removes runtimes of other releases.
 * 配布物をダウンロード・照合・展開し、別の Release の実行環境を削除する。
 */
export async function installRuntime(storageDir: string, b: Bundle, progress: (message: string) => void): Promise<Runtime> {
  const root = runtimeRoot(storageDir);
  const dir = runtimeDir(storageDir, b);
  const archive = `${dir}.tar.gz.part`;
  const unpacked = `${dir}.part`;
  fs.mkdirSync(root, { recursive: true });
  try {
    await downloadVerified(b.url, b.sha256, archive, progress);
    // Unpack next to the final place and move it there once complete.
    // 最終的な場所の隣に展開し、完了してから移す。
    progress('Unpacking');
    fs.rmSync(unpacked, { recursive: true, force: true });
    fs.mkdirSync(unpacked);
    await promisify(execFile)('tar', ['-xzf', archive, '-C', unpacked]).catch((e: Error) => {
      throw new Error(`Unpacking the runtime with tar failed: ${e.message}`);
    });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(path.join(unpacked, 'xpra-bundle'), dir);
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(unpacked, { recursive: true, force: true });
  }
  for (const other of fs.readdirSync(root)) {
    if (path.join(root, other) !== dir) fs.rmSync(path.join(root, other), { recursive: true, force: true });
  }
  return { dir };
}
