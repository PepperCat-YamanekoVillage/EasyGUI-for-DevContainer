#!/usr/bin/env node
// Runs the fast test suites. The integration test (real xpra/Xvfb and a
// headless Chromium, downloads the runtime on first use) runs only with
// --integration [storage-dir].
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const suites = [['node', ['test/activation-smoke.cjs']]];
const i = process.argv.indexOf('--integration');
if (i >= 0) {
  const storage = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : path.join(os.tmpdir(), 'easygui-it');
  suites.push(['node', ['dist/test/integration.js', storage]]);
}
let failed = 0;
for (const [cmd, args] of suites) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
