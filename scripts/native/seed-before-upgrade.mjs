// Only for the project-owned empty Android test AVD, never a user's physical phone.
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const adb = (...args) => execFileSync(adbPath, ['-P','5051','-s','emulator-5586',...args], {encoding:'utf8',timeout:20000});
if (!adb('emu','avd','name').split(/\r?\n/).map(line=>line.trim()).includes('jianjie_verify36')) throw new Error('Refusing an unknown Android target');
adb('shell','input','keyevent','KEYCODE_WAKEUP');
adb('shell','wm','dismiss-keyguard');
adb('shell','settings','put','system','screen_off_timeout','1800000');
const pid = adb('shell','pidof','dev.keepaccounts.jianjie2').trim();
if (!/^\d+$/.test(pid)) throw new Error('The project test app is not running');
adb('forward','tcp:9238',`localabstract:webview_devtools_remote_${pid}`);
const artifactDirectory=path.join(root,'.tools/native-test/playwright');
fs.mkdirSync(artifactDirectory,{recursive:true});
const browser = await chromium.connectOverCDP('http://127.0.0.1:9238',{noDefaults:true,artifactsDir:artifactDirectory});
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(page => /^https?:\/\/localhost\//.test(page.url()));
  if (!page) throw new Error('Expected project WebView was not found');
  await page.locator('.ledger-app').waitFor({timeout:20000});
  const snapshot = async () => page.evaluate(async () => {
    const result = await window.Capacitor.nativePromise('LedgerStore','read',{});
    return { ...result.snapshot, state: JSON.parse(result.snapshot.data) };
  });
  const before = await snapshot();
  if (before.state.transactions.length !== 0) throw new Error('The baseline requires the known empty test ledger; refusing to overwrite it');
  const active = () => page.locator('.lj-route-frame:not([hidden])');
  await active().getByRole('button',{name:'数据与设置',exact:true}).click();
  await active().getByRole('button',{name:/^从旧版 Excel 导入/}).click();
  const dialog = page.getByRole('dialog',{name:'导入旧账本',exact:true});
  await dialog.getByLabel('选择Excel文件',{exact:true}).setInputFiles({name:'native-baseline.xls',mimeType:'application/vnd.ms-excel',buffer:fs.readFileSync(path.join(root,'tests/fixtures/legacy-4.8.8-two-expenses.xls'))});
  await expect(dialog.getByLabel('当前工作表',{exact:true})).toBeVisible({timeout:30000});
  await dialog.getByRole('button',{name:'检查导入结果',exact:true}).click();
  await dialog.getByRole('button',{name:/^确认导入\s+2\s+笔$/}).click();
  await expect(dialog).not.toBeVisible({timeout:20000});
  const after = await snapshot();
  if (after.state.transactions.length !== 2 || after.state.transactions.reduce((sum,row)=>sum+row.amountCents,0) !== 2000) throw new Error('Native import totals did not match the fixture');
  const output = path.join(root,'.tools/native-test');
  fs.writeFileSync(path.join(output,'before-upgrade-snapshot.json'),JSON.stringify(after,null,2));
  await page.screenshot({path:path.join(output,'native-baseline-import.png'),fullPage:true});
  console.log(JSON.stringify({schemaVersion:after.state.schemaVersion,revision:after.revision,transactions:2,totalCents:2000,storage:'private SQLite',fixture:'original-app fictional export'}));
} finally {
  await browser.close();
}
