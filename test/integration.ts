// End-to-end test of everything except the VS Code UI: downloads the runtime
// (or reuses it), starts xpra + Xvfb, opens the HTML5 client page the display
// tab embeds in a headless Chromium, and drives an X11 application through it.
//
//   CHROMIUM=/path/to/chrome node dist/test/integration.js <storage-dir>
//
// The application is a small python3 tkinter program (python3-tk is present
// in the reference container); TEST_APPS may list more commands, one per line.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { chromium, Page } from 'playwright-core';
import { ClientProxy } from '../src/display/proxy';
import { RELEASE, checkPlatform, installRuntime, loadRuntime } from '../src/runtime/bundle';
import { canConnect } from '../src/server/probe';
import { clientPath } from '../src/server/xpraConfig';
import { XpraServer } from '../src/server/xpraServer';

const storage = path.resolve(process.argv[2]);
const outDir = path.join(storage, 'test-output');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

async function waitFor<T>(ms: number, poll: () => T | undefined | null | false | Promise<T | undefined | null | false>): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await poll();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

const TK_APP = `python3 -c "
import tkinter as tk
r = tk.Tk(); r.title('tk-test'); r.geometry('320x200')
e = tk.Entry(r); e.pack(fill='x'); e.focus_set()
n = [0]
def click(): n[0] += 1; print('CLICK', n[0], flush=True)
tk.Button(r, text='Press', command=click).pack()
e.bind('<KeyRelease>', lambda ev: print('ENTRY', e.get(), flush=True))
r.mainloop()
"`;

/** Starts a shell command on the display, appending its output to logFile. */
function launch(command: string, display: { DISPLAY: string; XAUTHORITY: string }, logFile: string): void {
  const out = fs.openSync(logFile, 'a');
  const env = { ...process.env, ...display, GDK_BACKEND: 'x11', QT_QPA_PLATFORM: 'xcb' };
  spawn('/bin/sh', ['-c', command], { env, detached: true, stdio: ['ignore', out, out] }).unref();
  fs.closeSync(out);
}

/** Geometry of the HTML5 client's window elements (decorated or not). */
async function windows(page: Page): Promise<{ id: string; title: string; x: number; y: number; w: number; h: number }[]> {
  return page.$$eval('#screen > div[id]:has(canvas)', (els) =>
    els.map((e) => {
      const c = e.querySelector('canvas')!.getBoundingClientRect();
      return { id: e.id, title: e.querySelector('.windowtitle')?.textContent ?? '', x: c.x, y: c.y, w: c.width, h: c.height };
    }),
  );
}

async function main(): Promise<void> {
  const bundle = checkPlatform();
  check('platform supported', true, bundle.arch);
  let rt = loadRuntime(storage, bundle);
  if (!rt) {
    const t0 = Date.now();
    let last = '';
    rt = await installRuntime(storage, bundle, (m) => {
      if (!m.startsWith('Downloading:')) console.log(`  [install] ${m}`);
      last = m;
    });
    check('runtime downloaded and verified', true, `${RELEASE}, ${last}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else {
    check('runtime reused', true, RELEASE);
  }

  // A run directory of its own, so the test never touches the server of an
  // EasyGUI extension running in the same container.
  const testRunDir = `/tmp/vscode-easygui-test-${process.getuid?.() ?? 0}`;
  fs.mkdirSync(testRunDir, { recursive: true, mode: 0o700 });
  const backend = new XpraServer(testRunDir);
  await backend.stop(() => {});
  const logFile = path.join(outDir, 'xpra.log');
  const st = await backend.start({ runtime: rt, display: 0, logFile, dpi: 96, log: (m) => console.log(`  ${m}`) });
  check('xpra server started', true, `display :${st.display}, port ${st.port}`);
  // The page and its WebSocket go through the client proxy, as in the display tab.
  const proxy = new ClientProxy();
  const proxyPort = await proxy.start(path.join(rt.dir, 'usr/share/xpra/www'), st.port);
  const base = `http://127.0.0.1:${proxyPort}/`;

  const files = await Promise.all(['', 'js/lib/jquery.js', 'js/lib/jquery-ui.js'].map(async (f) => [f || 'index.html', (await fetch(base + f)).status] as const));
  check('HTML5 client files are served', files.every(([, s]) => s === 200), files.map(([f, s]) => `${f} ${s}`).join(', '));

  const executablePath = process.env.CHROMIUM;
  if (!executablePath) {
    check('browser checks', false, 'set CHROMIUM to a Chromium/Chrome executable');
    await backend.stop(() => {});
    return;
  }
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    // A client without the password must be rejected.
    const bad = await browser.newPage();
    await bad.goto(`${base}index.html?password=wrong&insecure=true&reconnect=false`);
    const rejected = await waitFor(8000, () => /authentication failed|invalid password|wrong password/i.test(fs.readFileSync(logFile, 'utf8')));
    check('client with a wrong password is rejected', !!rejected);
    await bad.close();

    const appLog = path.join(outDir, 'apps.log');
    const env = { DISPLAY: `:${st.display}`, XAUTHORITY: st.xauthority };
    launch(TK_APP, env, appLog);

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(base + clientPath(st));
    const tk = await waitFor(15000, async () => (await windows(page)).find((w) => w.title.includes('tk-test')));
    check('application window shown in the HTML5 client', !!tk, tk ? `${tk.w}x${tk.h} at ${tk.x},${tk.y}` : '');
    if (!tk) return;
    check('window has the application size', Math.abs(tk.w - 320) <= 2 && Math.abs(tk.h - 200) <= 2, `${tk.w}x${tk.h}`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'tk.png') });

    const appOut = () => (fs.existsSync(appLog) ? fs.readFileSync(appLog, 'utf8') : '');
    await page.mouse.click(tk.x + 100, tk.y + 10);
    await page.keyboard.type('Hello html5!');
    check('keyboard input reaches the application', !!(await waitFor(5000, () => appOut().includes('ENTRY Hello html5!'))), appOut().trim().split('\n').pop());

    await page.mouse.click(tk.x + 160, tk.y + 35);
    check('mouse click reaches the application', !!(await waitFor(5000, () => appOut().includes('CLICK 1'))));

    await page.mouse.click(tk.x + 100, tk.y + 10);
    await page.keyboard.insertText('日本語');
    // Known limitation of the HTML5 client (it reads committed text only in tablet mode); reported, not counted.
    const ime = await waitFor(5000, () => appOut().includes('日本語'));
    console.log(`INFO committed IME text ${ime ? 'reaches' : 'does not reach'} the application`);

    // Extra applications, one command per line (e.g. xterm twice: the second
    // instance used to come up at xterm's stale 10x17 size hint).
    for (const [i, cmd] of (process.env.TEST_APPS ?? '').split('\n').filter(Boolean).entries()) {
      const before = new Set((await windows(page)).map((w) => w.id));
      const added = async () => (await windows(page)).filter((w) => !before.has(w.id));
      launch(cmd, env, appLog);
      const ws = await waitFor(20000, async () => {
        // GTK may add small helper windows; the main window must have a usable size.
        const ws = await added();
        return ws.some((w) => w.w > 100 && w.h > 50) && ws;
      });
      const detail = (ws || (await added())).map((w) => `${w.w}x${w.h}`).join(', ');
      check(`extra application ${i + 1} appears with a usable size`, !!ws, `${path.basename(cmd.split(' ').pop()!)}: ${detail || 'no window'}`);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, 'all-windows.png') });

    await page.setViewportSize({ width: 1000, height: 700 });
    check('tab resize resizes the X display', !!(await waitFor(5000, () => /virtual display now set to 1000x700/.test(fs.readFileSync(logFile, 'utf8')))));

    // Reconnect (what happens when the tab is reloaded): windows keep their size.
    await page.reload();
    const again = await waitFor(15000, async () => (await windows(page)).find((w) => w.title.includes('tk-test')));
    check('windows are back after reconnecting', !!again && Math.abs(again.w - 320) <= 2 && Math.abs(again.h - 200) <= 2, again ? `${again.w}x${again.h}` : '');
    await page.screenshot({ path: path.join(outDir, 'reconnected.png') });
  } finally {
    await browser.close();
    proxy.dispose();
    await backend.stop(() => {});
  }
  check('server stopped', !(await canConnect(st.port)) && !backend.readState());
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
    process.exit(failures ? 1 : 0);
  });
