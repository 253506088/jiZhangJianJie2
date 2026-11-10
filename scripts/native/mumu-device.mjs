import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const output = path.join(root, '.tools/mumu-compat');
export const appId = 'dev.keepaccounts.jianjie2';
const owner = JSON.parse(fs.readFileSync(path.join(output, 'owner.json'), 'utf8').replace(/^\uFEFF/, ''));
if (path.resolve(owner.project) !== path.resolve(root) || owner.vmIndex !== 1 || owner.name !== 'jianjie_compat12')
  throw new Error('Only the dedicated fictional-data MuMu instance is allowed');
const instance = JSON.parse(execFileSync(owner.manager, ['info', '-v', String(owner.vmIndex)], {encoding:'utf8',timeout:15000}));
if (instance.name !== owner.name || String(instance.created_timestamp) !== owner.createdTimestamp || !instance.is_android_started || instance.adb_host_ip !== '127.0.0.1')
  throw new Error('Project MuMu identity changed or is not running');
const binary = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
export const serial = `127.0.0.1:${instance.adb_port}`;
export function adb(...args) {
  return execFileSync(binary, ['-P','5052','-s',serial,...args], {encoding:'utf8',timeout:30000});
}
export async function connect() {
  const pid = adb('shell','pidof',appId).trim();
  if(!/^\d+$/.test(pid))throw new Error('Test app is not running');
  adb('forward','tcp:9239',`localabstract:webview_devtools_remote_${pid}`);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9239',{noDefaults:true,artifactsDir:output});
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('https://localhost/'));
  if(!page){await browser.close();throw new Error('Project WebView missing');}
  return {browser,page};
}
