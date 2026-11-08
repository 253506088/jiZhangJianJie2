// Only the project-owned, fictional-data verification AVD is allowed.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const output = path.join(root, '.tools/native-test');
export const appId = 'dev.keepaccounts.jianjie2';
const owner = JSON.parse(fs.readFileSync(path.join(output, 'owner.json'), 'utf8').replace(/^\uFEFF/, ''));
if (path.resolve(owner.project) !== path.resolve(root) || owner.avd !== 'jianjie_verify36' || owner.adbPort !== 5051 || owner.consolePort !== 5586)
  throw new Error('Project AVD ownership mismatch');
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
export function adb(...args) {
  return execFileSync(adbPath, ['-P', '5051', '-s', 'emulator-5586', ...args], { encoding: 'utf8', timeout: 30_000 });
}
if (!adb('emu', 'avd', 'name').split(/\r?\n/).some(line => line.trim() === owner.avd))
  throw new Error('Unknown emulator target');
export async function connect() {
  const pid = adb('shell', 'pidof', appId).trim();
  if (!/^\d+$/.test(pid)) throw new Error('Project app is not running');
  adb('forward', 'tcp:9238', `localabstract:webview_devtools_remote_${pid}`);
  let browser;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9238', { noDefaults: true, artifactsDir: output, timeout: 3000 });
      break;
    } catch (error) {
      if (attempt === 14) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const page = browser.contexts().flatMap(context => context.pages()).find(page => /^https?:\/\/localhost\//.test(page.url()));
  if (!page) { await browser.close(); throw new Error('No project WebView'); }
  return { browser, page };
}
export function hierarchy() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/jianjie-test-ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/jianjie-test-ui.xml');
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value]) => [key,value])));
  return { xml, nodes };
}
export function tapNode(predicate) {
  const node = hierarchy().nodes.find(predicate);
  if (!node) throw new Error('Requested system control not found');
  const bounds = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((bounds[0]+bounds[2])/2)), String(Math.round((bounds[1]+bounds[3])/2)));
  return node;
}
export function screenshot(name) {
  const remote = '/sdcard/jianjie-test-screen.png';
  adb('shell', 'screencap', '-p', remote);
  const local = path.join(output, name + '.png');
  adb('pull', remote, local);
  return local;
}
